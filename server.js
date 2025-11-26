/* Royford Data Deals server (Express + EJS + M-PESA STK Push scaffold)
  IMPORTANT:
  - Replace provisionBundle(...) with your real provisioning API.
  - Set environment variables from .env or hosting provider.
  - MPESA_CALLBACK_URL must be publicly reachable (use ngrok for local testing).
*/
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const morgan = require('morgan');
const fs = require('fs');
const dayjs = require('dayjs');
const { customAlphabet } = require('nanoid');
require('dotenv').config();

const app = express();
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const PORT = process.env.PORT || 3000;
const TILL_NUMBER = process.env.TILL_NUMBER || '6311719';

const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY || '',
  consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
  shortcode: process.env.MPESA_SHORTCODE || '',
  passkey: process.env.MPESA_PASSKEY || '',
  env: process.env.MPESA_ENV || 'sandbox',
  callbackUrl: process.env.MPESA_CALLBACK_URL || `https://example.com/mpesa/confirmation`
};

const PACKAGES = [
  { id: 'p_sh55', name: 'Sh55 - 1.25GB (till midnight)', price: 55, validity: 'till midnight', allowMultiple: false },
  { id: 'p_sh20', name: 'Sh20 - 250MB (24hrs)', price: 20, validity: '24hrs', allowMultiple: false },
  { id: 'p_sh19', name: 'Sh19 - 1GB (1hr)', price: 19, validity: '1hr', allowMultiple: false },
  { id: 'p_sh50', name: 'Sh50 - 1.5GB (3hrs)', price: 50, validity: '3hrs', allowMultiple: false },
  { id: 'p_sh99', name: 'Sh99 - 1GB (24hrs)', price: 99, validity: '24hrs', allowMultiple: false },
  { id: 'p_sh49', name: 'Sh49 - 350MB (7 days)', price: 49, validity: '7 days', allowMultiple: false },
  { id: 'p_ksh22', name: 'Ksh 22 - 1GB (1hr) [Multiple allowed]', price: 22, validity: '1hr', allowMultiple: true },
  { id: 'p_ksh52', name: 'Ksh 52 - 1.5GB (3hrs) [Multiple allowed]', price: 52, validity: '3hrs', allowMultiple: true },
  { id: 'p_ksh110', name: 'Ksh 110 - 2GB (24hrs) [Multiple allowed]', price: 110, validity: '24hrs', allowMultiple: true },
  { id: 'm_23', name: 'Ksh 23 - 45 mins (3hrs)', price: 23, validity: '3hrs', allowMultiple: false },
  { id: 'm_51', name: 'Ksh 51 - 50 mins (till midnight)', price: 51, validity: 'till midnight', allowMultiple: false },
  { id: 'm_101', name: 'Ksh 101 - 100 mins (48hrs)', price: 101, validity: '48hrs', allowMultiple: false },
  { id: 's_1000', name: '1000 SMS (Weekly) - Ksh 30', price: 30, validity: '7 days', allowMultiple: false },
  { id: 's_200', name: '200 SMS (Daily) - Ksh 10', price: 10, validity: '24hrs', allowMultiple: false },
  { id: 's_20', name: '20 SMS (Daily) - Ksh 5', price: 5, validity: '24hrs', allowMultiple: false }
];

const DATA_FILE = path.join(__dirname, 'transactions.json');
let TRANSACTIONS = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE);
    TRANSACTIONS = JSON.parse(raw);
  }
} catch (err) {
  console.error('Failed to load transactions:', err);
}
function persistTransactions() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(TRANSACTIONS, null, 2));
}
function findPackageById(id) {
  return PACKAGES.find(p => p.id === id);
}
function formatPhone(input) {
  let s = String(input).trim();
  s = s.replace(/\s+/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (/^0/.test(s)) {
    return '254' + s.slice(1);
  }
  if (/^7\d{8}$/.test(s)) {
    return '254' + s;
  }
  if (/^2547\d{8}$/.test(s)) {
    return s;
  }
  return s;
}
function hasPurchasedToday(phoneNormalized, pack) {
  const key = phoneNormalized;
  const today = dayjs().format('YYYY-MM-DD');
  if (!TRANSACTIONS[key]) return false;
  const entries = TRANSACTIONS[key].filter(t => t.date === today && t.status === 'SUCCESS');
  if (entries.length === 0) return false;
  if (pack.allowMultiple) return false;
  return true;
}
function recordTransaction(phoneNormalized, tx) {
  const key = phoneNormalized;
  if (!TRANSACTIONS[key]) TRANSACTIONS[key] = [];
  TRANSACTIONS[key].push(tx);
  persistTransactions();
}
async function getMpesaToken() {
  const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
  const url = MPESA_CONFIG.env === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  const res = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return res.data.access_token;
}
function lipaEndpoint() {
  return MPESA_CONFIG.env === 'production'
    ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
}
function timestamp() { return dayjs().format('YYYYMMDDHHmmss'); }
async function initiateStkPush(phone, amount, accountRef = 'RoyfordData') {
  const token = await getMpesaToken();
  const url = lipaEndpoint();
  const time = timestamp();
  const password = Buffer.from(`${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${time}`).toString('base64');
  const payload = {
    BusinessShortCode: MPESA_CONFIG.shortcode,
    Password: password,
    Timestamp: time,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: MPESA_CONFIG.shortcode,
    PhoneNumber: phone,
    CallBackURL: MPESA_CONFIG.callbackUrl,
    AccountReference: accountRef,
    TransactionDesc: `Royford Data Deals ${accountRef}`
  };
  const res = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
  return res.data;
}
async function provisionBundle(phone, pkg) {
  // Replace this with your provisioning gateway call or API
  console.log(`Provisioning ${pkg.name} to ${phone} (simulated)`);
  return { success: true, message: 'Provisioned (simulated)' };
}

app.get('/', (req, res) => { res.render('index', { packages: PACKAGES, till: TILL_NUMBER }); });

app.post('/pay', async (req, res) => {
  try {
    const { phone, packageId } = req.body;
    if (!phone || !packageId) return res.status(400).json({ error: 'phone and packageId are required' });

    const phoneNormalized = formatPhone(phone);
    const pkg = findPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    if (hasPurchasedToday(phoneNormalized, pkg)) {
      return res.status(403).json({ error: 'Only one purchase allowed per number per day for this package' });
    }

    const localTxId = nanoid();
    const stkResponse = await initiateStkPush(phoneNormalized, pkg.price, pkg.id);
    const tx = {
      id: localTxId,
      mpesa: stkResponse,
      phone: phoneNormalized,
      packageId: pkg.id,
      amount: pkg.price,
      status: 'PENDING',
      date: dayjs().format('YYYY-MM-DD'),
      createdAt: new Date().toISOString()
    };
    recordTransaction(phoneNormalized, tx);

    return res.json({ success: true, txId: localTxId, mpesa: stkResponse });
  } catch (err) {
    console.error('Error in /pay', err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

app.post('/mpesa/confirmation', async (req, res) => {
  try {
    const body = req.body;
    console.log('Received mpesa confirmation:', JSON.stringify(body).slice(0, 1000));
    const stkCallback = body?.Body?.stkCallback;
    if (stkCallback) {
      const checkoutRequestID = stkCallback?.CheckoutRequestID;
      const resultCode = stkCallback?.ResultCode;
      const resultDesc = stkCallback?.ResultDesc;
      let matched = null;
      for (const [phone, list] of Object.entries(TRANSACTIONS)) {
        for (const tx of list) {
          const savedCheckout = tx.mpesa?.CheckoutRequestID || tx.mpesa?.data?.CheckoutRequestID;
          if (savedCheckout && checkoutRequestID && savedCheckout === checkoutRequestID) {
            matched = { phone, tx }; break;
          }
        }
        if (matched) break;
      }
      if (!matched) {
        const items = (stkCallback?.CallbackMetadata?.Item || []);
        const amountItem = items.find(it => it.Name && it.Name.toLowerCase() === 'amount');
        const phoneItem = items.find(it => it.Name && ['msisdn','phoneno','phoneNumber','phone'].includes(it.Name.toLowerCase()));
        const amt = amountItem?.Value;
        const ph = phoneItem?.Value ? formatPhone(String(phoneItem.Value)) : null;
        if (ph && TRANSACTIONS[ph]) {
          const candidates = TRANSACTIONS[ph].filter(t => t.amount === amt && t.status === 'PENDING');
          if (candidates.length > 0) { matched = { phone: ph, tx: candidates[candidates.length - 1] }; }
        }
      }
      if (matched) {
        matched.tx.status = resultCode === 0 ? 'SUCCESS' : 'FAILED';
        matched.tx.resultCode = resultCode;
        matched.tx.resultDesc = resultDesc;
        matched.tx.confirmation = stkCallback;
        persistTransactions();
        if (resultCode === 0) {
          const pkg = findPackageById(matched.tx.packageId);
          try {
            const prov = await provisionBundle(matched.phone, pkg);
            matched.tx.provision = prov;
            persistTransactions();
            console.log('Provisioning result:', prov);
          } catch (provErr) { console.error('Provisioning failed:', provErr); }
        }
      } else { console.warn('No matching transaction found for STK callback', checkoutRequestID); }
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    console.log('Unhandled MPESA callback body. Saving for inspection.');
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('Error handling mpesa confirmation:', err);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Error' });
  }
});

app.get('/admin/transactions', (req, res) => { res.json(TRANSACTIONS); });

app.listen(PORT, () => { console.log(`Royford Data Deals app running on port ${PORT}`); });
