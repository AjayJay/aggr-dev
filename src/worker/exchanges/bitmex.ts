import Exchange from '../exchange'

// Fallback product list used when the BitMEX REST API is unreachable
// (e.g. geo-restricted). Add any pairs you trade here.
const BITMEX_FALLBACK_PRODUCTS = {
  products: [
    'XBTUSD', 'XBTUSDT', 'ETHUSD', 'ETHUSDT', 'XBTH25', 'XBTM25',
    'SOLUSD', 'SOLUSDT', 'BNBUSD', 'BNBUSDT', 'ADAUSD', 'ADAUSDT',
    'DOTUSD', 'DOTUSDT', 'LINKUSD', 'LINKUSDT', 'LTCUSD', 'LTCUSDT',
    'XRPUSD', 'XRPUSDT', 'BCHUSD', 'BCHUSDT', 'AVAXUSD', 'AVAXUSDT',
    'DOGEUSD', 'DOGEUSDT', 'MATICUSD', 'MATICUSDT'
  ],
  types: {
    XBTUSD: 'inverse', XBTUSDT: 'linear', ETHUSD: 'linear', ETHUSDT: 'linear',
    XBTH25: 'inverse', XBTM25: 'inverse',
    SOLUSD: 'linear', SOLUSDT: 'linear', BNBUSD: 'linear', BNBUSDT: 'linear',
    ADAUSD: 'linear', ADAUSDT: 'linear', DOTUSD: 'linear', DOTUSDT: 'linear',
    LINKUSD: 'linear', LINKUSDT: 'linear', LTCUSD: 'linear', LTCUSDT: 'linear',
    XRPUSD: 'linear', XRPUSDT: 'linear', BCHUSD: 'linear', BCHUSDT: 'linear',
    AVAXUSD: 'linear', AVAXUSDT: 'linear', DOGEUSD: 'linear', DOGEUSDT: 'linear',
    MATICUSD: 'linear', MATICUSDT: 'linear'
  },
  multipliers: {
    XBTUSD: -100000000, XBTUSDT: 1000000, ETHUSD: 1000000, ETHUSDT: 1000000,
    XBTH25: -100000000, XBTM25: -100000000,
    SOLUSD: 1000000, SOLUSDT: 1000000, BNBUSD: 1000000, BNBUSDT: 1000000,
    ADAUSD: 1000000, ADAUSDT: 1000000, DOTUSD: 1000000, DOTUSDT: 1000000,
    LINKUSD: 1000000, LINKUSDT: 1000000, LTCUSD: 1000000, LTCUSDT: 1000000,
    XRPUSD: 1000000, XRPUSDT: 1000000, BCHUSD: 1000000, BCHUSDT: 1000000,
    AVAXUSD: 1000000, AVAXUSDT: 1000000, DOGEUSD: 1000000, DOGEUSDT: 1000000,
    MATICUSD: 1000000, MATICUSDT: 1000000
  },
  underlyingToPositionMultipliers: {}
}

export default class BITMEX extends Exchange {
  id = 'BITMEX'
  private xbtPrice = 48000
  private types: { [pair: string]: 'quanto' | 'inverse' | 'linear' }
  private multipliers: { [pair: string]: number }
  private underlyingToPositionMultipliers: { [pair: string]: number }
  protected endpoints = {
    PRODUCTS: 'https://www.bitmex.com/api/v1/instrument/active'
  }

  async getProducts(forceFetch?: boolean): Promise<any> {
    try {
      const result = await super.getProducts(forceFetch)
      if (result && result.products && result.products.length) {
        return result
      }
      throw new Error('Empty products from API')
    } catch (err) {
      console.warn(
        `[BITMEX] Products API failed (${err.message}), using fallback hardcoded products list`
      )
      this.setProducts(BITMEX_FALLBACK_PRODUCTS)
      return BITMEX_FALLBACK_PRODUCTS
    }
  }

  async getUrl() {
    return `wss://www.bitmex.com/realtime`
  }

  formatProducts(data) {
    const products = []
    const types = {}
    const multipliers = {}
    const underlyingToPositionMultipliers = {}

    for (const product of data) {
      types[product.symbol] = product.isInverse
        ? 'inverse'
        : product.isQuanto
        ? 'quanto'
        : 'linear'
      multipliers[product.symbol] = product.multiplier

      if (types[product.symbol] === 'linear') {
        underlyingToPositionMultipliers[product.symbol] =
          product.underlyingToPositionMultiplier
      }

      products.push(product.symbol)
    }

    return {
      products,
      types,
      multipliers,
      underlyingToPositionMultipliers
    }
  }

  validateProducts(data) {
    if (
      !data ||
      !data.multipliers ||
      !data.underlyingToPositionMultipliers ||
      !data.types
    ) {
      return false
    }

    return true
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async subscribe(api, pair) {
    if (!(await super.subscribe(api, pair))) {
      return
    }

    api.send(
      JSON.stringify({
        op: 'subscribe',
        args: ['trade:' + pair, 'liquidation:' + pair]
      })
    )

    return true
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe(api, pair))) {
      return
    }

    api.send(
      JSON.stringify({
        op: 'unsubscribe',
        args: ['trade:' + pair, 'liquidation:' + pair]
      })
    )

    return true
  }

  onApiCreated(api) {
    api.send(
      JSON.stringify({
        op: 'subscribe',
        args: ['instrument:XBTUSD']
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (json && json.data && json.data.length) {
      if (json.table === 'liquidation' && json.action === 'insert') {
        return this.emitLiquidations(
          api.id,
          json.data.map(trade => {
            let size

            if (this.types[trade.symbol] === 'quanto') {
              size =
                (this.multipliers[trade.symbol] / 100000000) *
                trade.leavesQty *
                this.xbtPrice
            } else if (this.types[trade.symbol] === 'inverse') {
              size = trade.leavesQty / trade.price
            } else {
              size =
                (1 / this.underlyingToPositionMultipliers[trade.symbol]) *
                trade.leavesQty
            }

            return {
              exchange: this.id,
              pair: trade.symbol,
              timestamp: Date.now(),
              price: trade.price,
              size: size,
              side: trade.side === 'Buy' ? 'buy' : 'sell',
              liquidation: true
            }
          })
        )
      } else if (json.table === 'trade' && json.action === 'insert') {
        return this.emitTrades(
          api.id,
          json.data.map(trade => ({
            exchange: this.id,
            pair: trade.symbol,
            timestamp: +new Date(trade.timestamp),
            price: trade.price,
            size: trade.homeNotional,
            side: trade.side === 'Buy' ? 'buy' : 'sell'
          }))
        )
      } else if (json.table === 'instrument' && json.data[0].lastPrice) {
        this.xbtPrice = json.data[0].lastPrice
      }
    }
  }
}
