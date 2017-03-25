let os = require('os')

module.exports = {
  startEmitStats: (io) => {
    setInterval(() => {
      io.to('CPU').emit('f', { f: 'os', cpu: os.loadavg()[0], ram: ramUsage() })
    }, 5000)
  }
}

let ramUsage = () => {
  let totalMem = os.totalmem()
  let usedMem = totalMem - os.freemem()
  return usedMem / totalMem * 100
}
