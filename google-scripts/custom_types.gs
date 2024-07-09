/**
 * Budet app fields
 * @typedef {Object} BudgetAutomation.AccountParams
 * @property {String} account
 * @property {String} name
 */

/**
 * Extracted Fields
 * @typedef {Object} BudgetAutomation.TransactionFields
 * @property {BudgetAutomation.AccountParams} ynab
 * @property {BudgetAutomation.AccountParams} firefly
 * @property {String} merchange
 * @property {number} amount
 */

/**
 * Account Definition
 * @typedef {Object} BudgetAutomation.AccountObject
 * @function {boolean} match Checks if current 'from' email matches this account
 * @function {BudgetAutomation.TransactionFields} fields Extracts fields from the email 'body'
 */

/**
 * YNAB Transaction
 * @typedef {Object} BudgetAutomation.YNABTransaction
 * @property {string} id
 * @property {string} date
 * @property {number} amount
 * @property {string} memo
 * @property {string} cleared
 * @property {string} account_id
 * @property {string} payee_name
 * @property {boolean} approved
 */

/**
 * Budget Provider Type
 * @typedef {Object} BudgetAutomation.Provider
 * @property {string} name
 * @property {boolean} enabled
 * @property {function(BudgetAutomation.TransactionFields): boolean} functToRun
 * @property {function(string): string} account
 * @property {Object} labels
 * @property {Object} api
 */

/**
 * Stock price response
 * @typedef {Object} BudgetAutomation.StockResponse
 * @property {number} price Price of the requested stock
 * @property {string} error Reason for failure
 * @property {string} message User friendly reason for failure
 */

/**
 * ActualAccount
 * @typedef {Object} BudgetAutomation.ActualAccount
 * @param {string} id Account ID
 * @param {string} name Account Name
 * @param {string} type Account type
 * @param {boolean} offbudget Whether or not account is off budget (tracking)
 * @param {boolean} closed Whether or not account has been closed
 */
