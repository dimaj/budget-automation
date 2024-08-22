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

  automaticSavingsPlan_category: ({ date, transactionsToExclude, categories }) => {
    const budgetId = ynabProcessor.getBudgetId();
    const savingsTarget = categories.filter(cat => cat.note && cat.note.toLowerCase().indexOf('#asp') >= 0);
    
    // exit out if no category is ussed for AutomaticSavingsPlan
    if (savingsTarget.length == 0) return;

    const currentMonth = ynabProcessor.getMonths();
    const readyToAssign = currentMonth.data.month.to_be_budgeted;
    
    const transactions = ynabProcessor.getTransactions({since: date});
    const processedTransactions = [];
    let matchedTransactionCount = 0;
    const updates = savingsTarget.map(({id, note, name}) => {
      const match = Array.from(note.matchAll(/#asp\s* (\$?\d+%?) "?([^"]+)"?/ig));

      const amountToSave = match.reduce((res, [full, savingsAmount, payee]) => {
        const incomeTransactions = transactions
          .filter(transaction => transaction.payee_name === payee
                                 && transaction.amount > 0
          );
          matchedTransactionCount += incomeTransactions.length;
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
          return res + filteredTransactions.reduce((acc, cur) => acc + cur.amountToAdd, 0);
      }, 0);

      return amountToSave <= 0 ? undefined : { budgetId, categoryId: id, budgeted: Math.round(amountToSave) };
    })
    .filter(update => update);
    
    const totalSavings = updates.reduce((acc, cur) => acc + cur.budgeted, 0);
    if (readyToAssign <= totalSavings) {
      Logger.log(`Not enough funds for AutomaticSavingsPlan. Available $${readyToAssign / 1000}; Identified for savings: $${totalSavings / 1000}`);
      return { matchedTransactionCount, transactionIds: [], updates };
    }
    if (totalSavings === 0) {
      Logger.log(`Income savings: No matching transactions found`);
      return { matchedTransactionCount, transactionIds: [], updates };
    }
    return { matchedTransactionCount, transactionIds: [...new Set(processedTransactions)], updates };
  },
  automaticSavingsPlan_account: ({ date, transactionsToExclude, categories }) => {
    const budgetId = ynabProcessor.getBudgetId();
    let matchedTransactionCount = 0;
    const processedTransactions = [];

    // get all categories that are not hidden
    const updates = ynabProcessor.getAccounts()
      .filter(account => account.note && account.note.toLowerCase().indexOf('#asp') >= 0)
      .map(account => {
        const match = account.note.match(/#asp roundup "(.+)"/i);
        if (!match) return { matchedTransactionCount, transactionIds: [] };
        const destination = categories
          .find(category => category.name === match[1]);

        if (!destination) return { matchedTransactionCount, transactionIds: [] };;

        const expenseTransactions = ynabProcessor.getTransactions({ accountId: account.id, since: date })
          .filter(transaction => transaction.amount < 0);
        matchedTransactionCount += expenseTransactions.length;

        const transactions = expenseTransactions
          .filter(transaction => !transactionsToExclude.includes(transaction.id))
          .map(transaction => ({ id: transaction.id, amount: transaction.amount >= 0 ? 0 : 1000 - Math.abs(transaction.amount) % 1000 }))
          .filter(transaction => transaction.amount % 100 !== 0);

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
  automaticSavingsPlan: () => {
    const date = getDateString(0, 'PST', 'YYYY-MM-dd');
    const transactionsToExclude = JSON.parse(getPropertyValue('ynabASPProcessed')) || [];
    const budgetId = ynabProcessor.getBudgetId();
    const categories = JSON.parse(ynabProcessor.getCategories(budgetId).getContentText())
      .data.category_groups
      .reduce((cats, cur) => [...cats, ...cur.categories.filter(cat => !cat.hidden)], []);


    const incomeTransactions = ynabProcessor.automaticSavingsPlan_category({ date, transactionsToExclude, categories });
    const expenseTransactions = ynabProcessor.automaticSavingsPlan_account({ date, transactionsToExclude, categories });
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
      })
  }
};
