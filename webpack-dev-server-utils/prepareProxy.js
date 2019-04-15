const address = require("address");
const fs = require("fs");
const path = require("path");
const url = require("url");
const chalk = require("chalk");
const HttpProxyAgent = require("http-proxy-agent");
// const TProxyAgent = require("t-proxy-agent");

function resolveLoopback(proxy) {
  const o = url.parse(proxy);
  o.host = undefined;
  if (o.hostname !== "localhost") {
    return proxy;
  }
  // Unfortunately, many languages (unlike node) do not yet support IPv6.
  // This means even though localhost resolves to ::1, the application
  // must fall back to IPv4 (on 127.0.0.1).
  // We can re-enable this in a few years.
  /*try {
    o.hostname = address.ipv6() ? '::1' : '127.0.0.1';
  } catch (_ignored) {
    o.hostname = '127.0.0.1';
  }*/

  try {
    // Check if we're on a network; if we are, chances are we can resolve
    // localhost. Otherwise, we can just be safe and assume localhost is
    // IPv4 for maximum compatibility.
    if (!address.ip()) {
      o.hostname = "127.0.0.1";
    }
  } catch (_ignored) {
    o.hostname = "127.0.0.1";
  }
  return url.format(o);
}

// We need to provide a custom onError function for httpProxyMiddleware.
// It allows us to log custom error messages on the console.
function onProxyError(proxy) {
  return (err, req, res) => {
    const host = req.headers && req.headers.host;
    console.log(
      chalk.red("Proxy error:") +
        " Could not proxy request " +
        chalk.cyan(req.url) +
        " from " +
        chalk.cyan(host) +
        " to " +
        chalk.cyan(proxy) +
        "."
    );
    console.log(
      "See https://nodejs.org/api/errors.html#errors_common_system_errors for more information (" +
        chalk.cyan(err.code) +
        ")."
    );
    console.log();

    // And immediately send the proper error response to the client.
    // Otherwise, the request will eventually timeout with ERR_EMPTY_RESPONSE on the client side.
    if (res.writeHead && !res.headersSent) {
      res.writeHead(500);
    }
    res.end(
      "Proxy error: Could not proxy request " +
        req.url +
        " from " +
        host +
        " to " +
        proxy +
        " (" +
        err.code +
        ")."
    );
  };
}

async function prepareProxy(proxy, appPublicFolder) {
  if (!proxy) {
    return undefined;
  }
  if (typeof proxy !== "string" && typeof proxy !== "object") {
    console.log(
      chalk.red(
        'When specified, "proxy" in package.json must be a string or an object.'
      )
    );
    console.log(
      chalk.red('Instead, the type of "proxy" was "' + typeof proxy + '".')
    );
    console.log(
      chalk.red(
        'Either remove "proxy" from package.json, or make it a string or an object.'
      )
    );
    process.exit(1);
  }

  // If proxy is specified, let it handle any request except for files in the public folder.
  function mayProxy(pathname, context) {
    if (pathname.startsWith('/sockjs-node')) return false;
    const maybePublicPath = path.resolve(appPublicFolder, pathname.slice(1));
    return !fs.existsSync(maybePublicPath) && pathname.startsWith(context);
  }

  const isReachable = require("is-reachable");
  const useAgent = await isReachable("192.168.1.124:8080"); // 服务器地址

  const prepareProxyConfig = (proxy, context) => {
    const direct = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(
      url.parse(proxy).host
    );
    const agent =
      !direct && useAgent && new HttpProxyAgent("http://192.168.1.124:8080"); // 服务器地址



    if (!/^http(s)?:\/\//.test(proxy)) {
      console.log(
        chalk.red(
          'When "proxy" is specified in package.json it must start with either http:// or https://'
        )
      );
      process.exit(1);
    }

    let target;
    if (process.platform === "win32") {
      target = resolveLoopback(proxy);
    } else {
      target = proxy;
    }

    return {
      target,
      logLevel: "silent",
      agent: agent,
      // For single page apps, we generally want to fallback to /index.html.
      // However we also want to respect `proxy` for API calls.
      // So if `proxy` is specified as a string, we need to decide which fallback to use.
      // We use a heuristic: We want to proxy all the requests that are not meant
      // for static assets and as all the requests for static assets will be using
      // `GET` method, we can proxy all non-`GET` requests.
      // For `GET` requests, if request `accept`s text/html, we pick /index.html.
      // Modern browsers include text/html into `accept` header when navigating.
      // However API calls like `fetch()` won’t generally accept text/html.
      // If this heuristic doesn’t work well for you, use `src/setupProxy.js`.
      context: function(pathname, req) {
        return req.method !== "GET" || mayProxy(pathname, context);
      },
      onProxyReq: proxyReq => {
        // Browsers may send Origin headers even with same-origin
        // requests. To prevent CORS issues, we have to change
        // the Origin to match the target URL.
        if (proxyReq.getHeader("origin")) {
          proxyReq.setHeader("origin", target);
        }
      },
      onError: onProxyError(target),
      secure: false,
      changeOrigin: true,
      ws: true,
      xfwd: true
    };
  };

  if (typeof proxy === "string") return [prepareProxyConfig(proxy, "/")];
  return Object.keys(proxy)
    .sort((a, b) => b.length - a.length)
    .map(context => prepareProxyConfig(proxy[context], context));
}

module.exports = prepareProxy;
