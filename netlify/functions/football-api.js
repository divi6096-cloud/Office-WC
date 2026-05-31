// netlify/functions/football-api.js
// Proxies requests to football-data.org to avoid CORS issues in the browser.
// Deploy this file to netlify/functions/ in your project root.
// Add FOOTBALL_DATA_API_KEY to your Netlify environment variables.

const https = require('https')

const API_KEY = process.env.FOOTBALL_DATA_API_KEY || '878ffa632e5a4405901c84eb39a6b1c4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' }
  }

  const endpoint = event.queryStringParameters?.endpoint
  if (!endpoint) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'endpoint parameter required' }),
    }
  }

  const path = `/v4/${endpoint}`

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.football-data.org',
      path,
      method: 'GET',
      headers: { 'X-Auth-Token': API_KEY },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: data,
        })
      })
    })

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: err.message }),
      })
    })

    req.end()
  })
}
