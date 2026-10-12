// Just enough of Express (Router, use/get/post/put/patch, params, next/error flow)
// for the back-end route files to run unchanged in the browser.

function compile(path) {
  const keys = [];
  const re = path.replace(/\/:([A-Za-z_]+)/g, (_, k) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { keys, exact: new RegExp(`^${re}/?$`), prefix: new RegExp(`^${re === '/' ? '' : re}(?=/|$)`) };
}

export function Router() {
  const stack = [];
  const router = (req, res, done) => {
    let i = 0;
    const next = (err) => {
      if (res.finished) return;
      const layer = stack[i++];
      if (!layer) return done(err);
      const url = req.path;
      let m;
      if (layer.method) {
        if (layer.method !== req.method) return next(err);
        m = url.match(layer.match.exact);
      } else {
        m = url.match(layer.match.prefix);
      }
      if (!m) return next(err);
      if (err) {
        if (layer.handler.length === 4) return layer.handler(err, req, res, next);
        return next(err);
      }
      if (layer.handler.length === 4) return next();
      const params = { ...req.params };
      layer.match.keys.forEach((k, j) => (params[k] = decodeURIComponent(m[j + 1])));
      if (layer.method) {
        req.params = params;
        return runChain(layer.handlers, req, res, next);
      }
      // A mounted sub-router or middleware: strip the prefix for it.
      const saved = req.path;
      const sub = saved.slice(m[0].length) || '/';
      req.path = sub;
      try {
        layer.handler(req, res, (e) => {
          req.path = saved;
          next(e);
        });
      } catch (e) {
        req.path = saved;
        next(e);
      }
    };
    next();
  };
  const add = (method) => (path, ...handlers) => {
    stack.push({ method, match: compile(path), handlers, handler: handlers[0] });
    return router;
  };
  router.use = (path, ...handlers) => {
    if (typeof path !== 'string') {
      handlers.unshift(path);
      path = '/';
    }
    for (const h of handlers) stack.push({ method: null, match: compile(path), handler: h });
    return router;
  };
  router.get = add('GET');
  router.post = add('POST');
  router.put = add('PUT');
  router.patch = add('PATCH');
  router.delete = add('DELETE');
  return router;
}

function runChain(handlers, req, res, done) {
  let i = 0;
  const next = (err) => {
    if (err) return done(err);
    const h = handlers[i++];
    if (!h) return done();
    try {
      h(req, res, next);
    } catch (e) {
      done(e);
    }
  };
  next();
}

export default { Router };
