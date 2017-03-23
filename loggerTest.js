let lgr = require('./msg_format');

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

lgr.logMsg(blockList, macroInfo, lgr.LoggingLevels.ALL, fmt_g1, ['ok', 5]);

////
//Move data into the memory buffer
let emitBlockList = lgr.createBlockList();

lgr.processMsgsForWrite(logBlockList, lgr.LoggingLevels.ALL, emitBlockList);

////
//Write data to the console
let cwriter = lgr.createConsoleWriter();
let emitter = lgr.createEmitter(cwriter);

lgr.emitBlockList(emitter, emitBlockList);
