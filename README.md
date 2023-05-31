# DESCRPTION
failureproxy is a node.js proxy created to allow for simulation of changing network conditions (using toxy). Use interactively or in a test suite.

# INSTALLATION

## LOCAL USE
For use locally:
```bash
npm install
./failureproxy.js 9000 http://127.0.0.1:8081
```

## USE IN DOCKER NETWORK
For use in docker, build docker image set arguments via environment variables and run:

```bash
docker build -t $USER/node-failureproxy .
docker run --name failureproxy -p 9000:9000 -d --rm -e PROXYTARGET="http://host.docker.internal:8081" -e PROXYLOCALPORT=9000 $USER/node-failureproxy:latest       
```

### SUPPORTED PROXY STATE COMMANDS
These commands can be used to modify behaviour of proxy: 
- curl -X POST http://localhost:9000/_admin/close
- curl -X POST http://localhost:9000/_admin/open
- curl -X POST http://localhost:9000/_admin/status

### HOW TO TEST NETWORK LATENCY
Easiest way is to use docker ntework: https://www.sitespeed.io/documentation/sitespeed.io/connectivity/#docker-networks

### HOW TO CONFIGURE TOXY-POISONS

For full list of possible toxy-poisons for connection, please view toxy docs: https://github.com/h2non/toxy

Examples:

# Just low bandwith; 
curl -X POST -d "{toxy: { poisons: [{ bandwidth: { bps: 1024 } }], probability: 90 }}" -H "application/json" http://localhost:9000/_admin/toxy/open

# With slow read also: 
curl -X POST -d "{toxy: { poisons: [{ bandwidth: { bps: 1024 }},{ slowRead: { bps:128 }}], probability: 90 }}" -H "application/json" http://localhost:9000/_admin/toxy/open

# With latency also:
curl -X POST -d "{toxy: { poisons: [{ latency: 1000}, { bandwidth: { bps: 1024 }},{ slowRead: { bps:128, threshold: 100 }}], probability: 90 }}" -H "application/json" http://localhost:9000/_admin/toxy/open

# With rate limit instead:
curl -X POST -d "{toxy: { poisons: [{ rateLimit: { limit: 2, threshold: 5000 }}, { bandwidth: { bps: 1024 }},{ slowRead: { bps:128 }}], probability: 90 }}" -H "application/json" http://localhost:9000/_admin/toxy/open

# With http 502 error every time:
curl -X POST -d "{toxy: { poisons: [{ inject: { code: 502, body: 'Error', headers: { 'X_Toxy_Poison': 'error' }}}, { bandwidth: 1000 }], probability: 10 }}" -H "application/json" http://localhost:9000/_admin/toxy/open

# To stop it and resume normal proxy
curl -X POST -d "{}" -H "application/json" http://localhost:9000/_admin/toxy/close

