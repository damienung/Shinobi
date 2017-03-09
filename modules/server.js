let http = require('http');
let config = require('../conf.json');

module.exports.getServer = (app) => {
    let server = http.Server(app);
    server.listen(config.port);
    try {
        console.log('Shinobi - PORT : ' + config.port + ', NODE.JS : ' + execSync("node -v"));
    } catch (err) {
        console.log('Shinobi - PORT : ' + config.port);
    }

    return server;
}