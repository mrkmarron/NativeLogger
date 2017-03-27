let lgr = require('./msg_format');

let cwriter = lgr.createConsoleWriter();
let lgrFactory = lgr.createLoggerFactory('loggerTest', cwriter, '127.0.0.1');

let logger = lgrFactory.createLogger('lgr1', lgr.LoggingLevels.DEBUG, lgr.LoggingLevels.ALL);

////
//Create various formats
logger.addFormat('fmt_g1', 'msg is ${0:s} value is ${1:n} at time #wall_time');

////
//Log some data
logger.debug('fmt_g1', 'ok', 5);

