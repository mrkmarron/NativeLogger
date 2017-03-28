let logger = require('./msg_format')('submoduleTest', 'DEBUG', 'ALL');

////
//Create various formats
logger.addFormat('fmt_g1', 'This should be suppressed....');

////
//Log some data
logger.debug('fmt_g1');

