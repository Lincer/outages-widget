import handler from '../netlify/functions/getOutages.js'

async function main() {
  const req = new Request('http://localhost/test', { method: 'GET' })
  const res = await handler(req, {})

  console.log('Status:', res.status)
  const body = await res.json()
  console.log(JSON.stringify(body, null, 2))
}

main().catch(err => {
  console.error('Error:', err)
  process.exitCode = 1
})
