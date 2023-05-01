/**
 * Budget app fields
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
