var YAHOO_FINANCE_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/$SYMBOL?modules=price";

/**
 * Fetches stock price for a single ticker
 * @param symbol {string} - ticker to fetch the price for
 * @returns {object} a JSON object containing stock price or error info
 */
function fetchStockPrice(symbol) {
  if (symbol === 'CASH') {
    return { price: 1 }
  }

  var url = YAHOO_FINANCE_URL.replace("$SYMBOL", symbol);
  try {
    const response = UrlFetchApp.fetch(url, {corsDomain: 'finance.yahoo.com', muteHttpExceptions: true});
    var stock = JSON.parse(response);
  }
  catch (err) {
    console.error("Failed to fetch stock price for " + symbol + " due to " + stock.quoteSummary.error);
    return {
      error: err,
      message: "Failed to fetch stock price"
    };
  }
  
  if (stock.quoteSummary.error) {
    console.error("Failed to fetch stock price for " + symbol + " due to " + stock.quoteSummary.error);
    return { 
      message: "Failed to fetch stock price",
      error: stock.quoteSummary.error
    };
  }
  else {
    return {
      price: stock.quoteSummary.result[0].price.regularMarketPrice.raw
    };
  }
}

/**
 * Fetches properties that are needed to talk to YNAB
 * @returns {object} JSON object containing 'accountName' and 'budgetName' to work with
 */
function setupStocksVars() {
  return {
    accountName: userProperties.getProperty('ynabStocksAccountName'),
    budgetName: userProperties.getProperty('ynabStocksBudgetName')
  };
}

/**
 * Gets current portfolio value from notes on the account.
 * Account must have notes section defined as: 'INVESTMENTS: TICKER1 SHARE COUNT, TICKER2 SHARE COUNT'
 * If you hold cash in your brokereage account, use 'CASH' as ticker name
 * @param account {object} YNAB account that corresponds to the investments tracking
 * @returns {number} Portfolio value
 */
function getPortfolioValue(account) {
  var notes = account.note;
  if (notes.indexOf('INVESTMENTS:') == -1) {
    console.warn("Could not find 'INVESTMENTS:' in account " + account.name);
    return;
  }
  
  var investmentsStr = notes.replace(/INVESTMENTS:\s*/, '');
  var investments = investmentsStr.split(/,\s*/);
  return investments.map(curInvestment => {
    const [ticker, amount] = curInvestment.split(' ');
    if (!ticker || !amount) { 
      console.warn(`Either stock symbol or amount is missing. symbol=${ticker} amount=${amount}`);
      return 0;
    }
    const value = fetchStockPrice(ticker);
    if (value.error) {
      console.error(`There was an error while fetching stock price for: ${ticker}`);
      return 0;
    }
    return value.price * amount.replace(',');
  })
  .reduce((acc, curVal) => acc + curVal);

//  return Math.round(total * 100) / 100;
}

/**
 * Updates brokerage tracking account with today's delta by fetching investments from
 * account notes, calculating current account value and adding a transaction to YNAB.
 */
function updateStocksAccount() {
  if (!isWeekday) {
    // today is not a week day
    console.warn("Skipping execution due to today being not a weekday");
    return;
  }
  var config = setupStocksVars();
  var budget = getBudget(config.budgetName);
  var account = getAccount(budget, config.accountName);
  var curPortfolioValue = getPortfolioValue(account);
  var curAccountValue = getAccountValue(account);
  
  var amount = curPortfolioValue - curAccountValue;
  if (Math.abs(amount) >= 1) {
    console.log(`About to add a transaction for $${amount}`);
    const transaction = {
      budgetId: budget.id,
      accountId: account.id,
      amount: amount,
      payeeName: "Daily Account Balance Update",
      approved: true,
      cleared: 'cleared'
    };
    enterTransaction(transaction);
  }
  else {
    console.log(`Amount is '$${amount}'. No need to enter a new transaction.`);
  }
}

