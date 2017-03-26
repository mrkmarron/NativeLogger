let lgr = require('./msg_format');
let pino = require('pino')();

const iterCount = 100000;

////
//console
let clogstart = new Date();
for (var i = 0; i < iterCount; ++i) {
    console.log('msg is ' + 'ok' + ' value is ' + i + ' at time ' + new Date());
}

let clogend = new Date();
console.error(`Console: Iters = ${iterCount} -- Log time = ${clogend - clogstart}ms`);

////
//pino
let plogstart = new Date();
for (var i = 0; i < iterCount; ++i) {
    pino.info('msg is %s value is %d at time', 'ok', i, new Date())
}

let plogend = new Date();
console.error(`Pino: Iters = ${iterCount} -- Log time = ${plogend - plogstart}ms`);

///
//nativelogger
let cwriter = lgr.createConsoleWriter();
let lgrFactory = lgr.createLoggerFactory('loggerTest', cwriter, '127.0.0.1');

let logger = lgrFactory.createLogger('lgr1', lgr.LoggingLevels.DEBUG, lgr.LoggingLevels.ALL);

////
//Create various formats
logger.addFormat('fmt_g1', 'msg is ${0:s} value is ${1:n} at time #wall_time');

let nlogstart = new Date();
for (var i = 0; i < iterCount; ++i) {
    logger.debug('fmt_g1', 'ok', i);
}

////
//Move data into the memory buffer
logger.processMsgsForWrite();

let nlogend = new Date();
console.error(`NativeLogger: Iters = ${iterCount} -- Log time = ${nlogend - nlogstart}ms`);

////
//Write data to the console
let nwritestart = new Date();

logger.emit(function () {
    let nwriteend = new Date();
    console.error(`NativeLogger: Iters = ${iterCount} -- Write time = ${nwriteend - nwritestart}ms`);
});
