/* jshint esnext:true */

var slice = [].slice;

function stackFilter(stack) {
    return stack.split('\n').slice(1,4).filter(function(l) {
        return !~l.indexOf(__filename)
            && !~l.indexOf('GeneratorFunctionPrototype.next');
    }).join('\n');

}

function makeStackExtender(previous, noheader) {
    var e = new Error();
    return function(err) {
        var asyncStack = e.stack.substring(e.stack.indexOf("\n") + 1);
        if (err.stack) {
            if (!noheader) err.stack += '\nFrom generator:'
            err.stack += '\n' + stackFilter(asyncStack);
        }
        if (previous)
            err = previous(err);
       return err;
    }
}

function handleParallel(array, resumer) {
    if (!array.every(function(f){
        return f && (f      instanceof Function
                     || f.then instanceof Function)
    }))
        return;

    var pending = array.length,
    results = new Array(pending);

    var errored = false;
    function handler(k) {
        var called = false;
        return function(err, res) {
            if (errored) return;
            if (err) {
                errored = true;
                return resumer(err);
            }
            if (called) {
                errored = true;
                return resumer(new Error("thunk already called"));
            }
            called = true;
            results[k] = res;
            if (!--pending)
                resumer(null, results);
        }
    }
    array.forEach(function(item, k) {
        if (item.then instanceof Function)
            handlePromise(item, handler(k));
        else if (item instanceof Function)
            item(handler(k));
    });
}

function handlePromise(promise, handler) {
    promise.then(function promiseSuccess(result) {
        handler(null, result)
    }, function promiseError(err) {
        handler(err);
    });
}

function genny(gen) {
    return function start() {
        var args = slice.call(arguments), lastfn;

        if (args.length < 1) lastfn = null;
        else lastfn = args[args.length - 1];

        if (!(lastfn instanceof Function))
            lastfn = null;

        var complete = [], r = 0, generating = false;
        function createResumer(throwing, previous, i) {
            var extendedStack = exports.longStackSupport ? makeStackExtender(previous) : function identity(err) { return err; };

            return function _resume(/*err, res*/) {
                if (i in complete)
                    throw extendedStack(new Error("callback["+(i-1)+"] already called"));

                complete[i] = throwing ? arguments : [null, arguments];

                if (generating === false) try { // avoid running the generator when inside of it, the while loop will process it once we unwind
                    generating = true;
                    while (r in complete) {
                        var args = complete[r]; complete[r++] = void 0;
                        var result = args[0] ? iterator.throw(extendedStack(args[0])) : iterator.next(args[1]);
                        var value = result.value;
                        if (result.done && lastfn)
                            lastfn(null, value);
                        else if (value)
                            if (value.then instanceof Function)
                                handlePromise(value, resume());
                            else if (value instanceof Function)
                                value(resume()); // handle thunks
                            else if (value instanceof Array)
                                handleParallel(value, resume());
                    }
                } catch (e) {
                    if (lastfn) return lastfn(e);
                    else throw e;
                } finally {
                    generating = false;
                }
                //extendedStack = null;
            }
        }

        function makeResume(previous) {
            var resume = function() {
                return createResumer(true, previous, complete.length++);
            }
            resume.nothrow = function() {
                return createResumer(false, previous, complete.length++);
            }
            resume.gen = function() {
                var extendedStack;
                if (exports.longStackSupport)
                    extendedStack = makeStackExtender(previous, true);
                return makeResume(extendedStack);
            };
            return resume;
        }
        var resume = makeResume(null);
        if (lastfn)
            args[args.length - 1] = resume;
        else
            args.push(resume);
        var iterator = gen.apply(this, args); args = void 0;

        // send something undefined to start the generator
        resume()(null, void 0);
    }
}

var exports = module.exports = genny;

exports.longStackSupport = global.longStackSupport;

exports.fn = genny;

exports.listener = function(gen) {
    var fn = genny(gen);
    return function() {
        var args = [].slice.call(arguments);
        args.push(function ignoreListener(err, res) {});
        fn.apply(this, args);
    }
}

exports.middleware = function(gen) {
    var fn = genny(gen);
    return function(req, res, next) {
        fn(req, res, function(err, res) {
            if (next)
                if (err)
                    next(err);
                else if (res === true)
                    next();
        });
    }
}

exports.run = function(gen, cb) {
    if(cb)
        exports.fn(gen)(cb);
    else
        exports.fn(gen)();
}
