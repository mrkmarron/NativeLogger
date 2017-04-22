var assert = require('assert');

describe('BasicLog', function () {
    let logger = require('../logger')('basic', 'DEBUG', 'ALL');

    let writer = require('../writer').createStringWriter();
    logger.updateEmitMethod(writer);

    it('string literal msg', function () {
        logger.addFormat('fmt_lm1', 'hello world');
        logger.debug('fmt_lm1');

        assert.equal(writer.lastMsg, 'hello world');
    });
});