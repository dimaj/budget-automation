/**
 * @typedef {BudgetAutomation.StockProvider}
 * @property {string} endpoint Endpoint to call
 * @property {string} apiKey API key to use to make a request
 * @property {Object} fetchOptions Base options to use when making a request
 * @property {function(string)} getStockPrice Gets a value of a ticker
 */
const financeProviders = {
  globalFetchOptions: {
    muteHttpExceptions: true
  },
  alphavantage: {
    endpoint: 'https://www.alphavantage.co',
    apiKey: getPropertyValue('alphavantage_apikey'),
    fetchOptions: {
      method: 'GET',
      muteHttpExceptions: true
    },
    getStockPrice: symbol => {
      const endpoint = `${financeProviders.alphavantage.endpoint}/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${financeProviders.alphavantage.apiKey}`;
      try {
        const result = JSON.parse(UrlFetchApp.fetch(endpoint, financeProviders.alphavantage.fetchOptions));
        if (result.Note) {
          throw new Error(result.Note);
        }
        const priceKeyName = Object.keys(response['Global Quote']).find(key => key.match(/\. price$/));
        if (!priceKeyName) {
          return {
            message: `Could not determine price for '${symbol}'`,
            error: 'Price not found'
          };
        }

        return { price: response['Global Quote'][priceKeyName] };
      }
      catch (error) {
        Logger.log(`Failed to fetch stock price for '${symbol}' due to '${error}`);
        return 0;
      }
    }
  },
  yahoo: {
    endpoint: 'https://query2.finance.yahoo.com/v8/finance/chart',
    getStockPrice: symbol => {
      const endpoint = `${financeProviders.yahoo.endpoint}/${symbol.trim()}`;
      try {
        const results = JSON.parse(UrlFetchApp.fetch(endpoint, financeProviders.globalFetchOptions));
        return results.chart.result[0].meta.regularMarketPrice;
      } catch (e) {
        Logger.log(`Failed to get stocks from '${endpoint}' due to: ${e}`);
      }
    }
  }
};

const stocksProcessor = {
  // provider: financeProviders.alphavantage,
  provider: financeProviders.yahoo,

  stocksValues: {
    CASH: 1
  },

  /**
   * Fetch stock prices for a ticker
   * @param {string} symbol Symbol to fetch price for
   * @return {!BudgetAutomation.StockResponse} JSON object containing stock price or error info
   */
  fetchStockPrice: symbol => {
    symbol = symbol.toUpperCase();
    if (stocksProcessor.stocksValues[symbol]) {
      return stocksProcessor.stocksValues[symbol];
    }

    const ticker = symbol.endsWith(':') ? symbol.substring(0, symbol.length - 1) : symbol;
    const value = stocksProcessor.provider.getStockPrice(ticker);
    stocksProcessor.stocksValues[symbol] = value;

    return value;
  },

  /**
   * @private
   * Gets value of portfolio based on notes on the account.
   * Account must have a note with content define as: 'INVESTMENTS: ticker1 shareCount, ticker2 shareCount'
   * Or 'INVESTMENTS: ticker1: shareCount, ticker2: shareCount
   * @param {BudgetAutomation.Provider} provider Provider configuration
   * @param {string} accountName Name of the account to look at the notes for
   * @return {number} Portfolio value
   */
  getPortfolioValue: (provider, accountName) => {
    const account = provider.api.getAccount(accountName);
    let securities = {};
    if (account.note && account.note.indexOf('INVESTMENTS') >= 0) {
      account.note
        .replace(/INVESTMENTS:\s*/, '')
        .split(/,\s*/)
        .forEach(holding => {
          const [ticker, amount] = holding.replace(':', ' ').split(/\s+/);
          const normalizedTicker = ticker.toUpperCase();
          if (!ticker || !amount) { 
            console.warn(`Either stock symbol or amount is missing. symbol=${normalizedTicker} amount=${amount}`);
          }
          else {
            if(!Object.keys(securities).includes(normalizedTicker)) {
              securities[normalizedTicker] = 0;
            }
            securities[normalizedTicker] += parseFloat(amount.replace(',', ''));
          }
        });
    } else {
      provider.api.getTransactions({ accountId: account.id })
        .filter(transaction => {
          const match = transaction.notes
            ? transaction.notes.match(/(Buy|Sell)\s+(\w*)[\s:](.*)/i)
            : false;
          if (match) {
            const [fullMatch, action, ticker, amount] = transaction.notes.match(/(Buy|Sell)\s+(\w*)[\s:](.*)/i);
            const normalizedTicker = ticker.toUpperCase();
            if (!Object.keys(securities).includes(normalizedTicker)) {
              securities[normalizedTicker] = 0;
            }
            if (action.toUpperCase() === 'BUY') {
              securities[normalizedTicker] += parseFloat(amount.replace(',', ''));
            } else if (action.toUpperCase() === 'SELL') {
              securities[normalizedTicker] -= parseAmount(amount.replace(',', ''));
            } else {
              Logger.log(`Unknown action '${action}`);
            }
          }
        })
    }

    Logger.log(`Holding the following securities:`);
    Logger.log(securities);
    Logger.log('Prices are:');
    Logger.log(stocksProcessor.stocksValues);
    return Object.keys(securities)
      .reduce((res, cur) => {
        const amount = securities[cur];
        const results = stocksProcessor.fetchStockPrice(cur);
        Utilities.sleep(500);

        return res + results * amount;
      }, 0);
  },

  /**
   * Get names of accounts that need to be updated
   * These accounts are identified by having a note that containst `INVESTMENTS:` string
   * @param {BudgetAutomation.Provider} provider Provider configuration
   * @return {Array} Account names
   */
  getInvestmentAccounts: (provider) => {
    if (!Object.keys(provider.api).includes('getAccounts')) {
      Logger.log(`Provider '${provider.name}' does not implement 'getAccounts' method. Defaulting to 'investments'.`);
      return [provider.account('investments')];
    }
    const accounts = provider.api.getAccounts()
      .filter(account => account.note && account.note.indexOf('INVESTMENTS:') >= 0);
    return accounts;
  }
};
