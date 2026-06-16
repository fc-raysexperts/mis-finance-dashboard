const https = require('https');
const fs    = require('fs');

const CLIENT_ID     = '1000.TN3CRAQW3DS7W1KFY4UT3I4ROV49TS';
const CLIENT_SECRET = '26e67ef3a707f64b9f51bca966fe827199001b92f5';
const REFRESH_TOKEN = '1000.f33bb981108f494de65fd941a5e86297.b1e03934bd2d0ae287a4952ccfe70df9';
const ORG_ID        = '60038956413';

function post(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length
      }},
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve(JSON.parse(raw)));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: {
          Authorization: `Zoho-oauthtoken ${token}`
      }},
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve(JSON.parse(raw)));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Step 1: Getting access token...');
  const tokenData = await post(
    'accounts.zoho.in',
    '/oauth/v2/token',
    `refresh_token=${REFRESH_TOKEN}&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`
  );
  if (!tokenData.access_token) {
    console.error('FAILED:', JSON.stringify(tokenData, null, 2));
    process.exit(1);
  }
  console.log('Access token OK.');

  console.log('Step 2: Fetching P&L for March 2026...');
  const plData = await get(
    'www.zohoapis.in',
    `/books/v3/reports/profitandloss?organization_id=${ORG_ID}&from_date=2026-03-01&to_date=2026-03-31`,
    tokenData.access_token
  );

  fs.writeFileSync('pl_raw.json', JSON.stringify(plData, null, 2));
  console.log('Done. Saved to pl_raw.json');
  console.log('Top-level keys:', Object.keys(plData));
}

main();
