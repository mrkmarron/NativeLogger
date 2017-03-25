let lgr = require('./msg_format');
let pino = require('pino')();

////
//Create various formats
let fmt_g1 = lgr.createMsgFormat('fmt_g1', 'msg is ${0:s} value is ${1:n} at time #wall_time');

////
//Log some data
let logBlockList = lgr.createBlockList();
let macroInfo = {
    IP_ADDR: '127.0.0.1',
    APP_NAME: 'loggerTest',
    MODULE_NAME: 'loggerTest.js',
    LOGICAL_TIME: 3,
    CALLBACK_ID: 20,
    REQUEST_ID: -1
};

const iterCount = 100000;

/*
////
//console
let clogstart = new Date();
for (var i = 0; i < iterCount; ++i) {
    let args = ['ok', i];
    console.log('msg is ' + args[0] + ' value is ' + args[1] + ' at time ' + new Date());
}

let clogend = new Date();
console.error(`Console: Iters = ${iterCount} -- Log time = ${clogend - clogstart}ms`);

////
//pino
let plogstart = new Date();
for (var i = 0; i < iterCount; ++i) {
    let args = ['ok', i];
    pino.info('msg is %s value is %d at time', args[0], args[1], new Date())
}

let plogend = new Date();
console.error(`Pino: Iters = ${iterCount} -- Log time = ${plogend - plogstart}ms`);
*/
///
//nativelogger
let nlogstart = new Date();
for (var i = 0; i < iterCount; ++i) {
    let args = ['ok', i];
    logBlockList.logMessage(macroInfo, lgr.LoggingLevels.DEBUG, fmt_g1, args);
}

////
//Move data into the memory buffer
let emitBlockList = lgr.createBlockList();

logBlockList.processMsgsForWrite(lgr.LoggingLevels.ALL, emitBlockList);

let nlogend = new Date();
console.error(`NativeLogger: Iters = ${iterCount} -- Log time = ${nlogend - nlogstart}ms`);

////
//Write data to the console
let cwriter = lgr.createConsoleWriter();
let emitter = lgr.createEmitter(cwriter);

let nwritestart = new Date();

emitter.emitBlockList(emitBlockList, function () {
    let nwriteend = new Date();
    console.error(`NativeLogger: Iters = ${iterCount} -- Write time = ${nwriteend - nwritestart}ms`);
});
