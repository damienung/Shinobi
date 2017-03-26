let sql = require('./database.js').getConnection()

module.exports.deleteSubAccount = (uid, email, io) => {
  sql.query('DELETE FROM Users WHERE mail=?', [email])
  io.emit('f', {
    f: 'delete_sub_account',
    uid: uid
  })
}
