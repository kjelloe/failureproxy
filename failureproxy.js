#!/usr/bin/env node
const http = require('http')
const httpProxy = require('http-proxy') // DOCS: https://www.npmjs.com/package/http-proxy
const querystring = require('querystring')
const toxy = require('toxy') // DOCS: https://github.com/h2non/toxy

const args = process.argv
if (args.length<4) { throw new Error('Please provide ip:port and local pt i.e ./failureproxy.js 9000 http://127.0.0.1:8000') }

// Local definitions with defaults
const localPort = parseInt(args[2], 10)
const forwardTarget = args[3]
const proxyForwardDelaysMs = (args[4]? parseInt(args[4], 10) : 1) // Default to 1 ms
const PATH_ADMIN = (args[5]? args[5] : '/_admin')+'/' // Default to /_admin/
let defaultToxyPort = localPort+1

console.log(`Starting proxy on localhost:${localPort} forwarding to "${forwardTarget}" with admin url path set to "${PATH_ADMIN}"`)
console.log(`Proxy manipulation arguments: proxyForwardDelaysMs:${proxyForwardDelaysMs}`)

// Local toxy network failure proxy
const toxyProxy = toxy({ forward: forwardTarget, timeout: 6000 })

// Local state
const proxyState = {
  listenport: null,
  paused: false,
  open: false,
  delayms: proxyForwardDelaysMs,
  toxy: {
    port: defaultToxyPort,
    enabled: false,
    poisons: [{ bandwidth: null }],
    probability: null
  }}

// Helper methods for proxy. // TODO: Put into handler class
function getTimestamp() {
  return new Date().toString()
}

function sanitizeJsonString(murkyJson) {
  return murkyJson.replace(/\'/g,'"').replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ')
}

// Extract request data i.e from POST
async function extractRequestData(request) {
  const contentType = (request.headers['content-type']? request.headers['content-type'] : '')
  return await new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
       // If no data, i.e GET, return empty
      if (chunks.length == 0) return resolve('')
      const dataString = Buffer.concat(chunks).toString().trim()
      // If json data content or header, parse
      if ( (dataString.length>0 && dataString[0] == '{') || contentType.indexOf('json') !== -1 )
        return resolve(JSON.parse(sanitizeJsonString(dataString)))
      else // Else assume string or string encoding
        return resolve(querystring.parse(dataString))
    })
  }).catch(function(innerError) {
     return reject(innerError)
  })
}

// Change proxy handling of requests and responses
function updateProxyState(req, requestData, res) {

  this.actionMatch = (action) => {
    return req.url.startsWith(PATH_ADMIN+action)
  }

  // Check for admin actions as defined
  if (actionMatch('pause')) {
    proxyState.paused = getTimestamp()
  }
  else if(actionMatch('unpause')) {
    proxyState.paused = false
  }
  else if(actionMatch('close')) {
    proxyState.open = false
  }
  else if(actionMatch('open')) {
    proxyState.open = getTimestamp()
  }
  else if(actionMatch('toxy/close')) {
    stopToxyServer()
  }
  else if(actionMatch('toxy/open')) {
    if (requestData.toxy===false) throw new Error('Missing POST configuration data for /toxy/open. Expected json: toxy: { ... }')
    // If toxy already running, stop it first
    if (proxyState.toxy.enabled!==false) {
      toxyProxy.close()
      console.log('Stopping toxy server for reconfiguration...')
    }
    proxyState.toxy.port = requestData.toxy.port || proxyState.toxy.port
    proxyState.toxy.poisons = requestData.toxy.poisons || proxyState.toxy.poisons
    proxyState.toxy.probability = requestData.toxy.probability || proxyState.toxy.probability
    configureToxyServer()
    startToxyServer()
  }
  else if(actionMatch('delay')) {
    if (requestData.delayms===false) throw new Error('Missing POST configuration data for /delay: delayms')
  }
  else if(actionMatch('status')) {
    // Dummy method to return current proxystate
  }
  else {
    console.warn(`No admin action-keyword found for provided: "${req.url}"`)
  }

  // Allow for some config changes regardless of command:
  proxyState.delayms = (requestData.delayms? Number(requestData.delayms) : proxyState.delayms)

  return proxyState
}

// Creating proxy instance itself
const proxy = httpProxy.createProxyServer({ changeOrigin: true })

proxy.on('proxyReq', function(proxyReq, req, res, options) {
  proxyReq.setHeader('X-failureproxy', Date.now())
  console.log('REQUEST PROXIED: ' + req.url)
})

proxy.on('proxyRes', function (proxyRes, req, res) {
  /* TODO: manipulate response? Also, https://github.com/chimurai/http-proxy-middleware/issues/97
  var body = []
  proxyRes.on('data', function (chunk) {
    body.push(chunk)
  })so
  proxyRes.on('end', function () {
    body = Buffer.concat(body).toString()
    console.log("res from proxied server:", body)
    res.end("custom response...")
  })
  */
  console.log('RESPONSE('+proxyRes.statusCode+'): ' + JSON.stringify(proxyRes.headers))
})

proxy.on('error', function(errObject) {
  console.log('ERROR:', errObject)
})

proxy.on('close', function (res, socket, head) {
  console.log('CLOSE: Client disconnected')
})

// Create actual local http server
const proxyServer = http.createServer(async function(req, res) {
  // See if request should be processed
  if (req.url.startsWith(PATH_ADMIN) && req.method.toUpperCase()=='POST') {
    try {
      const requestDataParsed = await extractRequestData(req)
      const proxyStateJson = updateProxyState(req, requestDataParsed, res)
      console.log('ProxyState: ' + JSON.stringify(proxyStateJson))
      res.writeHead(200, {'Content-Type': 'application/json'})
      res.write(JSON.stringify(proxyStateJson))
      res.end()
    }
    catch (errProcessing) {
      console.error(errProcessing)
      res.writeHead(500)
      res.end(errProcessing.toString())
    }
    return
  }

  // Logging upon recieving request
  if (proxyState.delayms>1) console.log('REQUEST RECEIVED: ' + req.url)

  // Return promise since this method is async
  return await new Promise((resolve) => {

    setTimeout( function() {
      // Check current proxy state an execute state changes
      if (proxyState.open === false) {
        req.destroy()
        res.destroy()
        return
      }

      // If toxy proxy is enabled, forward to that on local port instead
      if (proxyState.toxy.enabled !== false) {
        proxy.web(req, res, { target:'http://localhost:'+proxyState.toxy.port   }) // TODO: SSL handling?
      }
      // Default to normal proxying of request
      else {
        proxy.web(req, res, { target:forwardTarget }) // TODO: For res body manipulation: selfHandleResponse : true
      }

      // Only now after timeout resolve promise
      return resolve(true)

    }, proxyState.delayms) // Wait NN ms to execute
  }).catch( function(asyncError) {
    throw new Error('Error in http.server.requesthandler, error:'+ asyncError)
  })
})

// Basic WS support  // TODO: Extend as needed
proxyServer.on('upgrade', function (req, socket, head) {
  proxy.ws(req, socket, head)
})

function configureToxyServer() {

  /* Data structure:
  toxy: {
    port: defaultToxyPort,
    enabled: false,
    poisons: [{ bandwidth: { bps: 1024 } }],
    probability: null
  }}  */

  // Extract arguments for this run
  if (Array.isArray(proxyState.toxy.poisons)===false) throw new Error('proxyState.toxy.poisons must be specified as an array. Found: ' + proxyState.toxy.poisons)
  // Enable all provided poisons
  proxyState.toxy.poisons.forEach( (poisonEntry) => {
    const poisonName = Object.keys(poisonEntry)[0] // Should only be one key, posion name, in in object
    const poisonConfig = poisonEntry[poisonName]
    if (!toxy.poisons[poisonName]) throw new Error(`Toxy poison with name "${poisonName}" does not exist`)
    toxyProxy.poison( toxy.poisons[poisonName]( poisonConfig ))
    console.log(`Added toxy.poison "${poisonName}" with parameters "${JSON.stringify(poisonConfig)}"`)
  })
  // Add provided probability
  toxyProxy.withRule(toxy.rules.probability(parseInt(proxyState.toxy.poisons.probability, 10)))
  // Set default route
  toxyProxy.all('/*')
  toxyProxy.forward(forwardTarget)
}

function startToxyServer() {
  try {
    setTimeout( function() {
      // Start toxy proxy
      toxyProxy.listen(proxyState.toxy.port, () => {
        console.log('Toxy proxy started. Listening on port: ' + proxyState.toxy.port)
        proxyState.toxy.enabled = getTimestamp()
      })
    }, 100) // Wait some time to spawn server
  } catch(toxyStartError) {
    console.log('Failed to start toxy server. Will retry until succesful, ERROR: ', toxyStartError)
    startToxyServer()
  }
}

function stopToxyServer() {
  toxyProxy.close( () => {
    console.log('Toxy proxy stopped. New connections will not be poisoned.')
    proxyState.toxy.enabled = false
  })
}

function startServer() {
  proxyServer.listen(localPort, () => {
    console.log('Server started. Listening on port: ' + localPort)
    proxyState.listenport = localPort
  })
}

function stopServer() {
  proxyServer.close( () => {
    console.log('Server stopped. New connections will be refused.')
     proxyState.listenport = null
  })
}

proxyState.open = getTimestamp()// Default to open state
startServer() // Finally start server
