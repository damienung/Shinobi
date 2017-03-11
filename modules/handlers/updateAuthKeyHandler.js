let config = require('../../conf.json');

module.exports = (req, res) => {
    req.ret = { ok: false };
    res.setHeader('Content-Type', 'application/json');
    req.fn = () => {
        if (!config.updateKey) {
            req.ret.msg = '"updateKey" is missing from "conf.json", cannot do updates this way until you add it.';
            return;
        }
        if (req.params.key === config.updateKey) {
            req.ret.ok = true;
            exec('chmod +x ' + __dirname + '/../../UPDATE.sh&&' + __dirname + '/../../UPDATE.sh')
        } else {
            req.ret.msg = '"updateKey" is incorrect.';
        }
        res.send(s.s(req.ret, null, 3));
    };
    s.auth(req.params, req.fn, res, req);
};