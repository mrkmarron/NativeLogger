let logger = require('./msg_format')('loggerTest', 'DEBUG', 'ALL');

//logger.enableSubLogger('submoduleTest');
require('./submoduleTest.js');

////
//Create various formats
logger.addFormat('fmt_g1', 'msg is ${0:s} value is ${1:n} at time #wall_time');

////
//Log some data
logger.debug('fmt_g1', 'ok', 5);

