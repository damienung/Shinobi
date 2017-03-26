let mysql = require('mysql')
let config = require('../conf.json')

module.exports.getConnection = () => {
  let sql = mysql.createConnection(config.db)
  sql.connect((err) => {
    if (err) {
      console.log('Error Connecting : DB', err)
    }
  })
  sql.on('error', (err) => {
    console.log('DB Lost.. Retrying..')
    console.log(err)
    this.getConnection()
  })

  return sql
}
