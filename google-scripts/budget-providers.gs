const globalLabels = {
    pending: getLabelOrCreate('Budget Automation/budget-to-process', false),
    ordersPending: getLabelOrCreate('Budget Automation/transactions-to-process', false)
  };
  
  /**
   * @type {!Object<string, !BudgetAutomation.Provider}
   */
  const budgetProviders = {
    ynab: {
      name: 'ynab',
      enabled: true,
      functToRun: ynabProcessor.processTransaction,
      account: name => JSON.parse(getPropertyValue('ynabEmailAutomationAccounts') || '{}')[name],
      labels: {
        transactionDone: getLabelOrCreate('Budget Automation/ynab-processed' ,true),
        ordersDone: getLabelOrCreate('Budget Automation/transactions-ynab-processed', true),
        ...globalLabels
      },
      api: ynabProcessor
    },
    firefly: {
      name: 'firefly',
      enabled: false,
      functToRun: fireflyProcessor.processTransaction,
      account: name => JSON.parse(getPropertyValue('fireflyEmailAutomationAccounts') || '{}')[name],
      labels: {
        transactionDone: getLabelOrCreate('Budget Automation/firefly-processed', true),
        ordersDone: getLabelOrCreate('Budget Automation/transactions-firefly-processed', true),
        ...globalLabels
      },
      api: fireflyProcessor
    },
    actual: {
      name: 'actual',
      enabled: true,
      functToRun: actualProcessor.processTransaction,
      account: name => JSON.parse(getPropertyValue('actualEmailAutomationAccounts') || '{}')[name],
      labels: {
        transactionDone: getLabelOrCreate('Budget Automation/actual-processed', true),
        ordersDone: getLabelOrCreate('Budget Automation/transactions-actual-processed', true),
        ...globalLabels
      },
      api: actualProcessor
    }
  };
  
  