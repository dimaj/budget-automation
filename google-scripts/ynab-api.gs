const ynabProcessor = {
  baseEndpoint: 'https://api.youneedabudget.com/v1',
  fetchOptions: {
    headers: {
      authorization: `Bearer ${getPropertyValue('ynabToken')}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    method: 'GET'
  },

  defaultBudgetName: getPropertyValue('ynabBudgetName'),
  budgetIds: {},

  getBudget: budgetName => {
    if (!budgetName) {
      budgetName = ynabProcessor.defaultBudgetName;
    }

    return JSON.parse(UrlFetchApp.fetch(`${ynabProcessor.baseEndpoint}/budgets`, ynabProcessor.fetchOptions))
      .data
      .budgets
      .find(budget => budget.name === budgetName);
  },

  getBudgetId: budgetName => {
    if (ynabProcessor.budgetIds[budgetName]) {
      return ynabProcessor.budgetIds[budgetName];
    }

    const budgetObj = ynabProcessor.getBudget(budgetName);
    const budgetId = budgetObj && budgetObj.id || undefined;
    ynabProcessor.budgetIds[budgetName] = budgetId;
    return budgetId;
  },

  getAccounts: budgetName => {
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const url = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/accounts`;
    return JSON.parse(UrlFetchApp.fetch(url, ynabProcessor.fetchOptions))
      .data
      .accounts;
  },

  getAccount: accountName => {
    return ynabProcessor.getAccounts()
      .find(account => account.name === accountName);
  },

  getAccountValue: accountName => ynabProcessor.getAccount(accountName).balance / 1000,

  getCategory: (budgetId, categoryName, date) => {
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId, date));
    return date 
      ? categories
      : categories.data.category_groups
        .flatMap(category_group => category_group.categories)
        .find(category_group => category_group.name === categoryName);
  },

  getCategories: budgetId => {
    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/categories`;
    return UrlFetchApp.fetch(endpoint, ynabProcessor.fetchOptions);
  },

  getCategory: (budgetId, categoryId, date) => {
    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/months/${date}/categories/${categoryId}`;
    return UrlFetchApp.fetch(endpoint, ynabProcessor.fetchOptions);
  },

  /**
   * Gets transactions
   * @param {string=} budgetName Defaults to getPropertyValue('ynabBudgetName')
   * @param {string=} categoryId
   * @param {string=} since Date in a form of 'YYYY-MM-dd'
   * @returns {!Array<BudgetAutomation.YNABTransaction>}
   */
  getTransactions: ({ budgetName, accountId, categoryId, since }) => {
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const sinceDate = since &&  `?since_date=${since}` || '';
    const account = accountId && `accounts/${accountId}/` || '';
    const category = (categoryId && account) && `categories/${categoryId}/` || '';

    let subpath = '';
    if (account !== '') {
      subpath = account;
    } else if (category !== '') {
      subpath = category;
    }

    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/${subpath}transactions${sinceDate}`;

    const response = UrlFetchApp.fetch(endpoint, ynabProcessor.fetchOptions);
    return response.getResponseCode() / 100 === 2 ? JSON.parse(response).data.transactions : undefined;
  },

  /**
   * Updates transactions
   * @param {string} budgetName
   * @param {!Array<BudgetAutomation.YNABTransaction}
   * @returns {UrlFetchApp.HTTPResponse}
   */
  updateTransactions: (transactions, budgetName = getPropertyValue('ynabBudgetName')) => {
    if (IsNullOrUndefined(transactions) || transactions.length === 0) {
      Logger.log('There are no transactions to update.');
      return true;
    }
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/transactions`;
    const options = {
      ...ynabProcessor.fetchOptions,
      method: 'PATCH',
      payload: JSON.stringify({ transactions }),
      url: endpoint
    };

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
        memo: memo || '#to-process Entered automatically by Google Apps Script automation',
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
  processTransaction({ ynab: { account }, account_id, amount, merchant, notes, category, cleared = 'uncleared'}) {
    const accountId = account || account_id;
    const clearedValue = (cleared === true || cleared === 'cleared') ? 'cleared' : 'uncleared';
    const transaction = {
      budgetId: ynabProcessor.getBudget(getPropertyValue('ynabBudgetName')).id,
      accountId,
      amount,
      payeeName: merchant,
      approved: false,
      memo: notes || undefined,
      category,
      cleared: clearedValue
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
      memo: transaction.memo.trim().replace(amazonTransactionId[0], `[${amazonTransactionId[0]}](${amazonOrderBaseUrl}${amazonTransactionId[0]})`)
    };
  },

  updateCategoryBalance: ({ budgetId, categoryId, budgeted, date }) => {
    const payload = { category: { budgeted } };
    const options = {
      ...ynabProcessor.fetchOptions,
      method: 'PATCH',
      payload: JSON.stringify(payload)
    };
    const dateStr = date || getDateString(0, 'UTC', 'YYYY-MM-dd');
    const endpoint = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/months/${dateStr}/categories/${categoryId}`
    return UrlFetchApp.fetch(endpoint, options);
  },

  getMonths: ({ budgetName, date = 'current' }) => {
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const url = `${ynabProcessor.baseEndpoint}/budgets/${budgetId}/months/${date}`;

    const options = {
      ...ynabProcessor.fetchOptions,
      method: 'GET'
    };

    return JSON.parse(UrlFetchApp.fetch(url, options));
  },

  cleanup: budgetName => {
    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth(), 0);
    
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    // get all categories that are not hidden
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId).getContentText())
      .data.category_groups
      .reduce((cats, cur) => [...cats, ...cur.categories.filter(cat => !cat.hidden)], []);
    // find categories that have notes with '#cleanup' defined
    const catsToClean = categories.filter(cat => cat.note && cat.note.toLowerCase().indexOf('#cleanup') >= 0);
    let totalSaved = 0;
    catsToClean.forEach(({ id: categoryId, note, name }) => {
      const { budgeted, balance: amount } = JSON.parse(ynabProcessor.getCategory(budgetId, categoryId, date)).data.category;
      if (amount <= 0) return;

      if(match = note.match(/#cleanup "?(.+?)"?$/)) {
        const destinationId = categories.find(cat => cat.name === match[1]).id;
        const destinationAmount = JSON.parse(ynabProcessor.getCategory(budgetId, destinationId, date))
          .data.category.budgeted;
        Logger.log(`Moving $${amount / 1000} from '${name}' to '${match[1]}'`);
        totalSaved += amount / 1000;
        // inreasing budget for destination category id
        ynabProcessor.updateCategoryBalance({
          budgetId,
          categoryId: destinationId,
          budgeted: destinationAmount + amount,
          date
        });
      } else {
        Logger.log(`Moving $${amount / 1000} from '${name}' to 'Ready to assign'`);
      }
      ynabProcessor.updateCategoryBalance({
        budgetId,
        categoryId,
        budgeted: budgeted - amount,
        date
      });
    });
    if (totalSaved > 0) {
      Logger.log(`Saved a total of $${totalSaved} last month!`);
    }
  },

  automaticSavingsPlan_category: ({ budgetName, date, transactionsToExclude, categories }) => {
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const savingsTarget = categories.filter(cat => cat.note && cat.note.toLowerCase().indexOf('#asp') >= 0);
    let matchedTransactionCount = 0;
    
    // exit out if no category is ussed for AutomaticSavingsPlan
    if (savingsTarget.length == 0) return { matchedTransactionCount, transactionIds: [], updates: [] };

    const currentMonth = ynabProcessor.getMonths({ budgetName });
    const readyToAssign = currentMonth.data.month.to_be_budgeted;
    
    const processedTransactions = [];
    const transactions = ynabProcessor.getTransactions({budgetName, since: date});
    const updates = savingsTarget.map(({id, note, name}) => {
      const match = Array.from(note.matchAll(/#asp\s* (\$?\d+%?) "?([^"]+)"?/ig));

      const amountToSave = match.reduce((res, [full, savingsAmount, payee]) => {
        const incomeTransactions = transactions
          .filter(transaction => transaction.payee_name === payee
                                 && transaction.amount > 0
          );
        const filteredTransactions = incomeTransactions
          .filter(transaction => !transactionsToExclude.includes(transaction.id))
          .map(({ id, amount }) => {
              const amountToAdd = savingsAmount.indexOf('$') >= 0
                ? parseFloat(savingsAmount.replace('$', ''))
                : savingsAmount.indexOf('%') >= 0
                  ? amount * parseFloat(savingsAmount.replace('%', '')) / 100
                  : null;
              if (amountToAdd === null) {
                Logger.log(`Invalid note '${full}'`);
                return { id, amount, amountToAdd: 0 };
              }
              return { id, amount, amountToAdd };
          });
        processedTransactions.push(...filteredTransactions.map(transaction => transaction.id));
        matchedTransactionCount += filteredTransactions.length;
        return res + filteredTransactions.reduce((acc, cur) => acc + cur.amountToAdd, 0);
      }, 0);

      return amountToSave <= 0 ? undefined : { budgetId, categoryId: id, budgeted: Math.round(amountToSave) };
    })
    .filter(update => update);
    
    const totalSavings = updates.reduce((acc, cur) => acc + cur.budgeted, 0);
    if (totalSavings === 0) {
      Logger.log(`Income savings: No matching transactions found`);
      return { matchedTransactionCount, transactionIds: [], updates: [] };
    }

    return { matchedTransactionCount, transactionIds: [...new Set(processedTransactions)], updates };
  },

  automaticSavingsPlan_account: ({ budgetName, date, transactionsToExclude, categories }) => {
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    let matchedTransactionCount = 0;
    const processedTransactions = [];

    // get all categories that are not hidden
    const updates = ynabProcessor.getAccounts(budgetName)
      .filter(account => account.note && account.note.toLowerCase().indexOf('#asp') >= 0)
      .map(account => {
        const match = account.note.match(/#asp roundup "(.+)"/i);
        if (!match) return { matchedTransactionCount, transactionIds: [] };
        const destination = categories
          .find(category => category.name === match[1]);

        if (!destination) return { matchedTransactionCount, transactionIds: [] };;

        const expenseTransactions = ynabProcessor.getTransactions({ budgetName, accountId: account.id, since: date })
          .filter(transaction => transaction.amount < 0 && transaction.transfer_account_id === null);

        const transactions = expenseTransactions
          .filter(transaction => !transactionsToExclude.includes(transaction.id))
          .map(transaction => ({ id: transaction.id, amount: transaction.amount >= 0 ? 0 : 1000 - Math.abs(transaction.amount) % 1000 }))
          .filter(transaction => transaction.amount % 100 !== 0);
        matchedTransactionCount += transactions.length;

        const amount = transactions.reduce((res, cur) => res + cur.amount, 0);
        const payload = { budgetId, categoryId: destination.id, budgeted: Math.round(amount) };

        processedTransactions.push(...transactions.map(transaction => transaction.id));
        return payload;
      });
    
    const totalSavings = updates.reduce((acc, cur) => acc + cur.budgeted, 0);
    if (totalSavings === 0) {
      Logger.log(`Round Ups: No matching transactions found`);
      return { matchedTransactionCount, transactionIds: [], updates };
    }
  
    return { matchedTransactionCount, transactionIds: [...new Set(processedTransactions)], updates };
  },
  
  automaticSavingsPlan: ({ budgetName } = {}) => {
    const date = getDateString(0, 'PST', 'YYYY-MM-dd');
    const transactionsToExclude = JSON.parse(getPropertyValue('ynabASPProcessed')) || [];
    const budgetId = ynabProcessor.getBudgetId(budgetName);
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId).getContentText())
      .data.category_groups
      .reduce((cats, cur) => [...cats, ...cur.categories.filter(cat => !cat.hidden)], []);


    const incomeTransactions = ynabProcessor.automaticSavingsPlan_category({ budgetName, date, transactionsToExclude, categories });
    const expenseTransactions = ynabProcessor.automaticSavingsPlan_account({ budgetName, date, transactionsToExclude, categories });
    let newTransactionsToExclude = null;
    if (incomeTransactions.matchedTransactionCount + expenseTransactions.matchedTransactionCount > 0) {
      newTransactionsToExclude = [
        ...transactionsToExclude,
        ...new Set(incomeTransactions.transactionIds),
        ...new Set(expenseTransactions.transactionIds)
      ];
    }
    updatePropertyValue('ynabASPProcessed', JSON.stringify(newTransactionsToExclude));
    const results = [];
    [...incomeTransactions.updates, ...expenseTransactions.updates]
      .filter(update => update.budgeted > 0)
      .forEach(update => {
        const category = categories.find(category => category.id === update.categoryId);
        const resultsCategory = results.find(result => result.data.category.id === update.categoryId);
        const curBudgeted = resultsCategory
          ? resultsCategory.data.category.budgeted
          : category
            ? category.budgeted
            : null;
        if (curBudgeted !== null) {
          Logger.log(`Adding a '$${update.budgeted / 1000}' to '${category.name}`);
          update.budgeted += curBudgeted;
        }
        results.push(JSON.parse(ynabProcessor.updateCategoryBalance(update)));
      });
  }
};
