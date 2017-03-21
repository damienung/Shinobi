module.exports = {
  ipRange: (startIp, endIp) => {
    let startLong = this.toLong(startIp)
    let endLong = this.toLong(endIp)
    if (startLong > endLong) {
      let tmp = startLong
      startLong = endLong
      endLong = tmp
    }
    let rangeArray = []
    let i
    for (i = startLong; i <= endLong; i++) {
      rangeArray.push(this.fromLong(i))
    }
    return rangeArray
  },
  portRange: (lowEnd, highEnd) => {
    let list = []
    for (let i = lowEnd; i <= highEnd; i++) {
      list.push(i)
    }
    return list
  },
  toLong: (ip) => {
    let ipl = 0
    ip.split('.').forEach((octet) => {
      ipl <<= 8
      ipl += parseInt(octet)
    })
    return (ipl >>> 0)
  },
  fromLong: (ipl) => {
    return ((ipl >>> 24) + '.' +
        (ipl >> 16 & 255) + '.' +
        (ipl >> 8 & 255) + '.' +
        (ipl & 255))
  }
}
