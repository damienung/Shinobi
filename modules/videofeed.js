let sql = require('./database.js').getConnection();

module.exports.killOpenVideoFeeds = () => {
    process.on('exit', ffmpegKill.bind(null, { cleanup: true }));
    process.on('SIGINT', ffmpegKill.bind(null, { exit: true }));

    sql.query('SELECT * FROM Videos WHERE status=?', [0], (err, r) => {
        if (r && r[0]) {
            r.forEach((v) => {
                s.init(0, v);
                v.filename = s.moment(v.time);
                s.video('close', v);
            });
        }
    });
};

ffmpegKill = () => {
    exec("ps aux | grep -ie ffmpeg | awk '{print $2}' | xargs kill -9");
};