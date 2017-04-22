let logger = require('./logger')('loggerTest', 'DEBUG', 'ALL');

    let writer = require('./writer').createStringWriter();
    logger.updateEmitMethod(writer);

        logger.addFormat('fmt_lm1', 'hello world');
        logger.debug('fmt_lm1');
        