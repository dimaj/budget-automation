const ynabProcessor = {
  baseEndpoint: 'https://api.youneedabudget.com/v1',
  fetchOptions: {
    headers: {
      authorization: `Bearer ${getPropertyValue('ynabToken')}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    method: 'GET'
  },

  budgetName: getPropertyValue('ynabBudgetName'),
  budgetIds: {},

  getBudget: budgetName => {
    return JSON.parse(UrlFetchApp.fetch(`${ynabProcessor.baseEndpoint}/budgets`, ynabProcessor.fetchOptions))
      .data
      .budgets
      .find(budget => budget.name === budgetName);
  },

  getBudgetId: budgetName => {
    if (!budgetName) {
      budgetName = ynabProcessor.budgetName;
    }

    if (ynabProcessor.budgetIds[budgetName]) {
      return ynabProcessor.budgetIds[budgetName];
    }

    const budgetObj = ynabProcessor.getBudget(budgetName);
    const budgetId = budgetObj && budgetObj.id || undefined;
    ynabProcessor.budgetIds[budgetName] = budgetId;
    return budgetId;
  },

  getAccount: accountName => {
    const budgetId = ynabProcessor.getBudgetId();
    const url = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/accounts`;
    return JSON.parse(UrlFetchApp.fetch(url, ynabProcessor.fetchOptions))
      .data
      .accounts
      .find(account => account.name === accountName);
  },

  getAccountValue: accountName => ynabProcessor.getAccount(accountName).balance / 1000,

  getCategory: (budgetId, categoryName) => {
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId));
    return categories.data.category_groups
      .flatMap(category_group => category_group.categories)
      .find(category_group => category_group.name === categoryName);
  },

  getCategories: budgetId => {
    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/categories`;
    return UrlFetchApp.fetch(endpoint, ynabProcessor.fetchOptions);
  },

  /**
   * Gets transactions
   * @param {string=} budgetName Defaults to getPropertyValue('ynabBudgetName')
   * @param {string=} categoryId
   * @param {string=} since Date in a form of 'YYYY-MM-dd'
   * @returns {!Array<BudgetAutomation.YNABTransaction>}
   */
  getTransactions: ({ accountId, categoryId, since }) => {
    const budgetId = ynabProcessor.getBudgetId();
    const sinceDate = IsNullOrUndefined(since) ? '' : `?since_date=${since}`;
    const account = IsNullOrUndefined(accountId) ? '' : `accounts/${accountId}/`
    const category = IsNullOrUndefined(categoryId) && account === '' ? '' : `categories/${categoryId}/`;

    let subpath = '';
    if (account !== '') {
      subpath = account;
    } else if (category !== '') {
      subpath = category;
    }

    const endpoint = `${url}/budgets/${budgetId}/${subpath}transactions${sinceDate}`;

    const response = UrlFetchApp.fetch(endpoint, ynabProcessor.fetchOptions);
    return response.getResponseCode() / 100 === 2 ? JSON.parse(response).data.transactions : undefined;
  },

  /**
   * Updates transactions
   * @param {!Array<BudgetAutomation.YNABTransaction}
   * @param {string} budgetName
   * @returns {UrlFetchApp.HTTPResponse}
   */
  updateTransactions: (transactions, budgetName) => {
    if (IsNullOrUndefined(transactions) || transactions.length === 0) {
      Logger.log('There are no transactions to update.');
      return true;
    }
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const endpoint = `${url}/budgets/${budgetId}/transactions`;
    const options = {
      ...ynabProcessor.fetchOptions,
      method: 'PATCH',
      payload: JSON.stringify({ transactions }),
      url: endpoint
    };

    // return UrlFetchApp.fetch(endpoint, options);
    return UrlFetchApp.fetchAll([options]);
  },

  /**
   * @param {!BudgetAutomation.YNABTransaction} transaction
   * @returns {UrlFetchApp.HTTPResponse}
   */
  enterTransaction: ({ budgetId, accountId: account_id,  amount, 
      payeeName: payee_name, approved = false, cleared, memo, 
      category: category_id = undefined } = transaction) => {
    var transactionData = {
      transaction: {
        account_id,
        date: Utilities.formatDate(new Date(), "PST", "yyyy-MM-dd"),
        amount: parseInt(amount * 1000),
        payee_name,
        memo: memo || 'Entered automatically by Google Apps Script automation #to-process',
        cleared,
        approved,
        category_id
      }
    };
    
    var options = {
      ...ynabProcessor.fetchOptions,
      method: 'POST',
      payload: JSON.stringify(transactionData)
    };
    
    var endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/transactions`;
    return UrlFetchApp.fetch(endpoint, options);
  },

  /**
   * Processes an email for YNAB
   * 
   * @returns {boolean}
   */
  processTransaction({ ynab: { account }, amount, merchant, notes, category, cleared = 'uncleared'}) {
    const clearedValue = (cleared === true || cleared === 'cleared') ? 'cleared' : 'uncleared';
    const transaction = {
      budgetId: ynabProcessor.getBudget(getPropertyValue('ynabBudgetName')).id,
      accountId: account,
      amount,
      payeeName: merchant,
      approved: false,
      memo: notes || undefined,
      category,
      cleared
    };

    Logger.log(`About to submit YNAB transaction for '${merchant}' in the amount of '${amount}'`);
    // submit ynab transaction
    const res = ynabProcessor.enterTransaction(transaction);
    return Math.round(res.getResponseCode() / 100) === 2;
  },

  updateTransactionMemoForAmazon: (transaction, regex) => {
    if (IsNullOrUndefined(transaction.memo)) {
      return null;
    }
    
    const amazonTransactionId = transaction.memo.match(regex);
    if (!amazonTransactionId) {
      return null;
    }

    return {
      ...transaction,
      memo: transaction.memo.replace(amazonTransactionId[0], `[${amazonTransactionId[0]}](${amazonOrderBaseUrl}${amazonTransactionId[0]})`)
    };
  },

  updateCategoryBalance: ({ budgetId, categoryId, budgeted, month }) => {
    const payload = { category: { budgeted } };
    const options = {
      ...ynabProcessor.fetchOptions,
      method: 'PATCH',
      payload: JSON.stringify(payload)
    };
    const monthInMillis = month && 30 * 24 * 3600 * 1000 || 0;
    const date = monthInMillis && getDateString(monthInMillis, 'UTC', 'YYYY-MM-dd') || getDateString(0, 'UTC', 'YYYY-MM-dd');
    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/months/${date}/categories/${categoryId}`
    return UrlFetchApp.fetch(endpoint, options);
  },

  getMonths: (date = 'current') => {
    const budgetId = ynabProcessor.getBudgetId();
    const url = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/months/${date}`;

    const options = {
      ...ynabProcessor.fetchOptions,
      method: 'GET'
    };

    return JSON.parse(UrlFetchApp.fetch(url, options));
  },

  cleanup: budgetName => {
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    // get all categories that are not hidden
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId).getContentText())
      .data.category_groups
      .reduce((cats, cur) => [...cats, ...cur.categories.filter(cat => !cat.hidden)], []);
    // find categories that have notes with '#cleanup' defined
    const catsToClean = categories.filter(cat => cat.note && cat.note.toLowerCase().indexOf('#cleanup') >= 0);
    
    catsToClean.forEach(({balance: amount, id: categoryId, note, name}) => {
      if (amount <= 0) return;

      if(match = note.match(/#cleanup "?(.+?)"?$/)) {
        Logger.log(match);
        const {id: destinationId } = categories.find(cat => cat.name === match[1]);
        Logger.log(`Moving $${amount / 1000} from '${name}' to '${match[1]}'`);
        ynabProcessor.updateCategoryBalance({
          budgetId,
          categoryId: destinationId,
          budgeted: amount
        });
      } else {
        Logger.log(`Moving $${amount / 1000} from '${name}' to 'Ready to assign'`);
      }
      ynabProcessor.updateCategoryBalance({
        budgetId,
        categoryId,
        budgeted: amount * -1
      });
    });
  },

  automaticSavingsPlan: () => {
    const budgetId = ynabProcessor.getBudgetId();
    // get all categories that are not hidden
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId).getContentText())
      .data.category_groups
      .reduce((cats, cur) => [...cats, ...cur.categories.filter(cat => !cat.hidden)], []);
    // find categories that have notes with '#asp' defined
    const savingsTarget = categories.filter(cat => cat.note && cat.note.toLowerCase().indexOf('#asp') >= 0);
    
    // exit out if no category is ussed for AutomaticSavingsPlan
    if (savingsTarget.length == 0) return;

    const date = getDateString(0, 'PST', 'YYYY-MM-dd');
    const currentMonth = ynabProcessor.getMonths();
    const readyToAssign = currentMonth.data.month.to_be_budgeted;
    
    const transactions = ynabProcessor.getTransactions({since: date});
    savingsTarget.forEach(({id, note, name}) => {
      const match = Array.from(note.matchAll(/#asp\s*:? (\d+)% "?([^"]+)"?/ig));
      const amountToSave = match.reduce((res, [full, percentage, payee]) => {
        const amount = transactions
          .filter(transaction => transaction.payee_name === payee && transaction.matched_transaction_id)
          .reduce((res, transaction) => res + transaction.amount, 0);
        const amountToSave = amount * percentage / 100;
        return res + amountToSave;
      }, 0);
      
      if (readyToAssign <= amountToSave) {
        Logger.log('Not enough funds for AutomaticSavingsPlan');
        return;
      }
      Logger.log(`Adding ${amountToSave / 1000} to '${name}'`)
      const payload = {budgetId, categoryId: id, budgeted: Math.round(amountToSave)};
      ynabProcessor.updateCategoryBalance(payload);
    });
  }
};
