let express = require('express');
let config = require('../conf.json');
let bodyParser = require('body-parser');

module.exports.route = (app) => {
    ////Pages
    app.use(express.static(config.videosDir));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.set('views', __dirname + '/../web/pages');
    app.set('view engine', 'ejs');

    //readme
    app.get('/info', (req, res) => {
        res.sendFile(__dirname + '/../index.html');
    });

    //main page
    app.get('/', (req, res) => {
        res.render('index');
    });

    return app;
}