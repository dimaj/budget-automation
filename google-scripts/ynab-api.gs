var userProperties = PropertiesService.getScriptProperties();
var accessToken = userProperties.getProperty('ynabToken');

// YNAB API settings
var url = 'https://api.youneedabudget.com/v1'
var headers = {
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type":"application/json; charset=utf-8"
};

function getYnabConfig() {
  return {
    accountName: userProperties.getProperty('ynabStocksAccountName'),
    budgetName: userProperties.getProperty('ynabStocksBudgetName')
  };
}

function getBudget(budgetName) {
  var budgets = JSON.parse(UrlFetchApp.fetch(`${url}/budgets`, { headers })).data.budgets;
  return findObjectByKey(budgets, 'name', budgetName);                                     
}

function getAccount(budgetObj, accountName) {
  var accountsUrl = url + '/budgets/' + budgetObj.id + '/accounts';
  var accounts = JSON.parse(UrlFetchApp.fetch(accountsUrl, { headers })).data.accounts;
  return findObjectByKey(accounts, 'name', accountName);
}

function getCategory(budgetId, categoryName) {
  const categories = JSON.parse(getCategories(budgetId));
  return categories.data.category_groups
    .flatMap(c => c.categories)
    .filter(c => c.name === categoryName)
    .shift()
  ;
}

function getAccountValue(account) {
  return account.balance / 1000;
}

function getCategories(budgetId) {
  const options = {
    method: "GET",
    headers
  };
    
  const categoryURL = `${url}/budgets/${budgetId}/categories`;
  return UrlFetchApp.fetch(categoryURL, options);
}

function getTransactions(budgetId, categoryId, since) {
  const options = {
    method: "GET",
    headers
  };

  var sinceDate = since ? `?since_date=${since}` : "";
  
  var reqUrl = `${url}/budgets/${budgetId}/categories/${categoryId}/transactions${sinceDate}`;
  return UrlFetchApp.fetch(reqUrl, options);
}
    
/**
 * @returns {UrlFetchApp.HTTPResponse}
 */
function enterTransaction({ budgetId, accountId, amount, payeeName, approved = false, cleared, memo, category } = transaction) {  
  var transactionData = {
    transaction: {
      account_id: accountId,
      date: Utilities.formatDate(new Date(), "PST", "yyyy-MM-dd"),
      amount: parseInt(amount * 1000),
      payee_name: payeeName,
      memo: memo || 'Entered automatically by Google Apps Script automation #to-process',
      cleared,
      approved,
      category_id: category || undefined
    }
  };
  
  var options = {
    method: 'POST',
    payload: JSON.stringify(transactionData),
    headers
  };
  var transactionUrl = `${url}/budgets/${budgetId}/transactions`;
  // console.log("Transaction url is: %s", transactionUrl);
  return UrlFetchApp.fetch(transactionUrl, options);
}
