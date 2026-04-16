import store from '@/store'
import { Trade } from '@/types/types'

const TELEGRAM_API_URL = 'https://api.telegram.org'

class TelegramService {
  private cooldownMap: Map<string, number> = new Map()
  private defaultCooldown = 5000

  isEnabled(paneId: string): boolean {
    const settings = store.state[paneId]
    return !!(
      settings?.telegramEnabled &&
      settings?.telegramBotToken &&
      settings?.telegramChatId
    )
  }

  isConfigured(paneId: string): { valid: boolean; error?: string } {
    const settings = store.state[paneId]

    if (!settings?.telegramBotToken) {
      return { valid: false, error: 'Bot Token is required' }
    }

    if (!settings?.telegramChatId) {
      return { valid: false, error: 'Chat ID is required' }
    }

    if (!settings?.telegramBotToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
      return { valid: false, error: 'Invalid Bot Token format' }
    }

    return { valid: true }
  }

  getThreshold(paneId: string): number {
    const settings = store.state[paneId]
    return settings?.telegramThreshold || 100000
  }

  shouldNotify(paneId: string, trade: Trade): boolean {
    if (!this.isEnabled(paneId)) {
      console.log('[Telegram] Not enabled for pane:', paneId)
      return false
    }

    const threshold = this.getThreshold(paneId)
    console.log(
      `[Telegram] Trade amount: ${trade.amount}, Threshold: ${threshold}`
    )

    if (trade.amount < threshold) {
      console.log(`[Telegram] Skipped: Trade size ${trade.amount} is below Telegram threshold ${threshold}`)
      return false
    }

    const key = `${trade.exchange}:${trade.pair}:${trade.side}`
    const lastNotify = this.cooldownMap.get(key)
    const now = Date.now()

    if (lastNotify && now - lastNotify < this.defaultCooldown) {
      return false
    }

    this.cooldownMap.set(key, now)
    console.log(
      '[Telegram] Will send notification for:',
      key,
      'amount:',
      trade.amount
    )
    return true
  }

  async sendTradeNotification(paneId: string, trade: Trade): Promise<void> {
    console.log(
      '[Telegram] Checking trade:',
      trade.exchange,
      trade.pair,
      trade.side,
      trade.amount
    )

    if (!this.shouldNotify(paneId, trade)) {
      return
    }

    const settings = store.state[paneId]
    const botToken = settings.telegramBotToken
    const chatId = settings.telegramChatId
    const message = this.formatSingleTrade(trade)

    console.log('[Telegram] Sending message to Telegram...')

    try {
      const response = await fetch(
        `${TELEGRAM_API_URL}/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
          })
        }
      )

      if (!response.ok) {
        const data = await response.json()
        console.error('[TelegramService] API Error:', data)
      } else {
        console.log('[TelegramService] Message sent successfully!')
      }
    } catch (error) {
      console.error('[TelegramService] Network Error:', error)
    }
  }

  async sendTestMessage(
    paneId: string
  ): Promise<{ success: boolean; error?: string }> {
    const configCheck = this.isConfigured(paneId)
    if (!configCheck.valid) {
      return { success: false, error: configCheck.error }
    }

    const settings = store.state[paneId]
    const botToken = settings.telegramBotToken
    const chatId = settings.telegramChatId

    const message =
      `<b>🧪 TEST NOTIFICATION</b>\n\n` +
      `This is a test message from Aggr.\n\n` +
      `<b>Exchange:</b> TEST_EXCHANGE\n` +
      `<b>Pair:</b> TEST/USDT\n` +
      `<b>Side:</b> BUY\n` +
      `<b>Size:</b> $250.00K\n` +
      `<b>Price:</b> $50,000\n` +
      `<b>Time:</b> ${new Date().toISOString()}\n\n` +
      `If you see this, your Telegram bot is configured correctly!`

    try {
      const response = await fetch(
        `${TELEGRAM_API_URL}/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
          })
        }
      )

      const data = await response.json()

      if (!response.ok) {
        console.error('[TelegramService] Test API Error:', data)
        return {
          success: false,
          error: data.description || `HTTP ${response.status}`
        }
      }

      return { success: true }
    } catch (error) {
      console.error('[TelegramService] Test Network Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      }
    }
  }

  formatSingleTrade(trade: Trade): string {
    const sideMatch = (trade.side || 'unknown').toLowerCase()
    const sideUpper = (trade.side || 'UNKNOWN').toUpperCase()
    const emoji = trade.liquidation ? '💀' : sideMatch === 'buy' ? '🟢' : '🔴'
    const type = trade.liquidation ? '⚠️ LIQUIDATION' : '📊 TRADE'
    const amount = typeof trade.amount === 'number' ? trade.amount : 0
    const size = this.formatAmount(amount)
    const price = this.formatPrice(trade.price)
    const pair = (trade.pair || 'UNKNOWN').replace('_', '/')
    const timestamp =
      typeof trade.timestamp === 'number' && !Number.isNaN(trade.timestamp)
        ? new Date(trade.timestamp).toISOString()
        : new Date().toISOString()

    return (
      `<b>${emoji} ${type}</b>\n\n` +
      `<b>Exchange:</b> ${trade.exchange}\n` +
      `<b>Pair:</b> ${pair}\n` +
      `<b>Side:</b> ${sideUpper}\n` +
      `<b>Size:</b> ${size}\n` +
      `<b>Price:</b> ${price}\n` +
      `<b>Time:</b> ${timestamp}`
    )
  }

  formatAmount(amount: number): string {
    if (amount >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(2)}M`
    } else if (amount >= 1_000) {
      return `$${(amount / 1_000).toFixed(2)}K`
    }
    return `$${amount.toFixed(2)}`
  }

  formatPrice(price: number): string {
    if (!price) {
      return '0.00'
    }
    if (price >= 1000) {
      return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
    } else if (price >= 1) {
      return price.toFixed(4)
    } else {
      return price.toFixed(8)
    }
  }
}

export default new TelegramService()
