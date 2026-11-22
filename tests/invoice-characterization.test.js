'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../lib/pricing');
const tax = require('../lib/tax');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

test('CURRENT BEHAVIOUR: order pricing uses the HSN slab and taxes the discounted line value', () => {
  const items = [{ id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 2 }];
  const totals = pricing.computeTotals(items, '');

  assert.deepEqual(totals, {
    subtotal: 200,
    discount: 0,
    taxable: 200,
    tax: 10,
    cgst: 5,
    sgst: 5,
    total: 210,
    lines: [{ id: 1, name: 'Rice', hsn: '1006', gstPercent: 5, gross: 200, discount: 0, taxable: 200, tax: 10, net: 210 }]
  });
});

test('invoice matches the billed order total and applies the HSN slab', () => {
  const order = {
    id: 1001,
    coupon: '',
    items: [{ name: 'Rice', hsn: '1006', price: 100, qty: 2 }]
  };

  assert.deepEqual(invoice.computeInvoiceFigures(order), {
    subtotal: 200,
    discount: 0,
    tax: 10,
    cgst: 5,
    sgst: 5,
    total: 210,
    rows: [{ name: 'Rice', sku: '-', hsn: '1006', qty: 2, price: 100, gstPercent: 5, line: 200, lineTax: 10 }]
  });
});

test('CURRENT BEHAVIOUR: order pricing applies SAVE10 to subtotal before GST', () => {
  const totals = pricing.computeTotals([{ hsn: '1006', price: 100, qty: 10 }], 'SAVE10');
  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.discount, 100);
  assert.equal(totals.tax, 45);
  assert.equal(totals.total, 945);
});

test('invoice applies SAVE10 to subtotal before HSN GST, matching billed totals', () => {
  const figures = invoice.computeInvoiceFigures({
    coupon: 'SAVE10',
    items: [{ hsn: '1006', price: 100, qty: 10 }]
  });
  assert.equal(figures.subtotal, 1000);
  assert.equal(figures.discount, 100);
  assert.equal(figures.tax, 45);
  assert.equal(figures.total, 945);
});

test('invoice applies configured maximum coupon discount', () => {
  const figures = invoice.computeInvoiceFigures({
    coupon: 'SAVE10',
    items: [{ price: 100, qty: 100 }]
  });
  assert.equal(figures.discount, 150);
  assert.equal(figures.tax, 1773);
  assert.equal(figures.total, 11623);
});

test('CURRENT BEHAVIOUR: an explicit gstRate is interpreted as a percent on the invoice', () => {
  const order = { coupon: '', items: [{ price: 100, qty: 1, gstRate: 5 }] };
  const priced = pricing.computeTotals(order.items, '');
  const billed = invoice.computeInvoiceFigures(order);

  assert.equal(priced.tax, 5);
  assert.equal(billed.tax, 5);
  assert.equal(billed.cgst, 2.5);
  assert.equal(billed.sgst, 2.5);
});

test('invoice uses the tax helper interpretation for decimal gstRate', () => {
  const item = { price: 100, qty: 1, gstRate: 0.05 };
  assert.equal(tax.getRateForItem(item), 0.05);
  assert.equal(pricing.computeTotals([item], '').tax, 5);
  assert.equal(invoice.computeInvoiceFigures({ items: [item] }).tax, 5);
});

test('CURRENT BEHAVIOUR: reconciliation reports the invoice/order mismatch and excludes cancelled orders', () => {
  const db = {
    products: [],
    customers: [],
    orders: [
      { id: 7, date: '01/01/2026', customer: 'A', coupon: '', status: 'completed', subtotal: 200, discount: 0, tax: 10, total: 210, items: [{ name: 'Rice', hsn: '1006', price: 100, qty: 2 }] },
      { id: 8, status: 'cancelled', subtotal: 200, discount: 0, tax: 10, total: 210, items: [{ hsn: '1006', price: 100, qty: 2 }] }
    ]
  };
  const recon = reports.getGstReconciliation(db);

  assert.equal(recon.totalChecked, 1);
  assert.equal(recon.mismatchCount, 0);
  assert.equal(recon.totalDelta, 0);
  assert.equal(recon.rows[0].invoiceTax, 10);
  assert.equal(recon.rows[0].invoiceTotal, 210);
  assert.equal(recon.rows[0].matched, true);
});

test('invoice render escapes customer text and displays billed total without a mismatch warning', () => {
  const html = invoice.render({
    id: 42,
    date: '01/01/2026',
    customer: '<Buyer>',
    coupon: '',
    total: 210,
    items: [{ name: 'Rice', hsn: '1006', price: 100, qty: 2 }]
  });

  assert.match(html, /&lt;Buyer&gt;/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹210\.00/);
  assert.doesNotMatch(html, /differs from Order Ledger/);
});
