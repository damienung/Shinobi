let os = require('os');
let io;

module.exports.setup = (iio) => {
    io = iio;
};

module.exports.emit = (intervalInms) => {

    try {
        cpuUsage = (e) => {
            e(os.loadavg()[0]); //1 minute load average
        };
        ramUsage = () => {
            let totalMem = os.totalmem();
            let usedMem = totalMem - os.freemem();
            return usedMem / totalMem * 100;
        };
        setInterval(() => {
            cpuUsage((d) => {
                io.to('CPU').emit({ f: 'os', cpu: d, ram: ramUsage() });
            });
        }, intervalInms);
    } catch (err) { console.log('CPU indicator will not work. Continuing...'); }


};