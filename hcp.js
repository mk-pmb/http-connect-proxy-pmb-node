/*jslint indent: 2, maxlen: 80, node: true */
/* -*- coding: UTF-8, tab-width: 2 -*- */
'use strict';

var EX = exports, net = require('net'),
  logmsg = console.log.bind(console),
  carrier = require('carrier'),
  nextconnId = require('maxuniqid')();


/** test: env https_proxy=https://localhost:8443/ wget -O /dev/null \
    --no-check-certificate https://example.net/
**/


EX.defaultRequestTimeout_ms = 5000;
EX.defaultHttpMessages = {
  200: 'Connection established',
  500: 'Internal Proxy Error',
  501: 'Not Implemented',
  504: 'Gateway Timeout',
};


function orf(x) { return (x || false); }
function isStr(x, no) { return (((typeof x) === 'string') || no); }
function mthdOvr(m, a, b) { return (orf(a)[m] || orf(b)[m] || EX[m]); }

function rxg(r, s, g) {
  var m = orf(r && r.exec(s));
  return ((g || (g === 0)) ? orf(m[g]) : m);
}


EX.runFromCLI = function () {
  var prx, cfg = {
    port: (+process.env.HCP_PORT || +process.env.PORT || 8443),
    lsnHost: (process.env.HCP_BIND || ''),
  };
  prx = EX.createConnectProxy(cfg);
  prx.cfg = cfg;
  process.once('SIGHUP', function () {
    logmsg('received hangup signal, will close proxy server.');
    prx.close();
  });
  prx.on('listening', function () {
    logmsg('now listening on', prx.address());
  });
  prx.on('error', function (err) { logmsg('server error: ' + err); });
  prx.on('close', function () { logmsg('server finished.'); });
};


EX.createConnectProxy = function (cfg) {
  if (!cfg) { cfg = false; }
  var prx = net.createServer();
  prx.on('connection', EX.serveOneConnection.bind(prx));
  if (cfg.port) { prx.listen(cfg.port, cfg.lsnHost || 'localhost'); }
  return prx;
};


EX.serveOneConnection = function (clntSock) {
  var prx = orf(this), ctx = { prx: prx, connId: nextconnId(),
    peerAddr: clntSock.remoteAddress,
    buffer: '',
    clntSock: clntSock,
    destSock: null,
    byteCount_sent: 0,
    byteCount_rcvd: 0,
    };
  ctx.log = logmsg.bind(null, 'conn#' + ctx.connId + ':');

  ctx.log('connect from ' + ctx.peerAddr);
  clntSock.setTimeout(EX.defaultRequestTimeout_ms);

  clntSock.on('error', EX.abandonBothParties.bind(ctx, 'client'));
  clntSock.on('data',  EX.recvIntoBuffer.bind(ctx));
  clntSock.on('close',  ctx.log.bind(null, 'client close, error?'));
};


EX.abandonBothParties = function (disrupter, err) {
  var ctx = this, reason = String(err);
  if (disrupter) { reason = String(disrupter) + ': ' + reason; }
  ctx.log('abandoning: ' + reason);
  ['clntSock', 'destSock'].forEach(function (sockProp) {
    if (!ctx[sockProp]) { return; }
    try {
      ctx[sockProp].destroy();
    } catch (ignore) {
      /* ignore; nothing left we can do anyways */
    }
    ctx[sockProp] = null;
  });
};


EX.connectReqRgx = /^CONNECT ([a-z0-9_\-\.]+:[0-9]+) HTTP\/1\.[01]$/i;
EX.recvIntoBuffer = function (data) {
  var ctx = this;
  ctx.buffer += data.toString('ascii').replace(/\r/g, '');
  if (ctx.buffer.substr(-2, 2) === '\n\n') { EX.dialout(ctx); }
};


EX.splitHostPort = function (r) {
  var p = orf((isStr(r) && r.split(/:(\d+)$/)) || r);
  return { host: (p.host || p[0] || ''), port: (+p.port || +p[1] || 0) };
};


EX.onInvalidRequest = function (ctx) { return EX.httpReply(ctx, 501); };

EX.onDialUpstream = function (ctx, dest) {
  ctx.log('destination: ' + dest.host + ':' + dest.port);
  ctx.buffer = null;
  return net.createConnection(dest.port, dest.host);
};


EX.dialout = function (ctx) {
  ctx.clntSock.removeAllListeners('data');
  ctx.buffer = ctx.buffer.split(/\n+/);
  ctx.log('request: ' + ctx.buffer.join('¶ ') + '¶');

  var prx = ctx.prx, upSock,
    dest = EX.splitHostPort(rxg(EX.connectReqRgx, ctx.buffer[0], 1));
  if (!dest) { return mthdOvr('onInvalidRequest', prx)(ctx); }
  ctx.origDest = Object.assign({}, dest);
  upSock = mthdOvr('onDialUpstream', prx)(ctx, dest);
  if (!upSock) { return; }
  ctx.destSock = upSock;
  ctx.destSock.on('error',   EX.httpReply.bind(null, ctx, 504));
  ctx.destSock.on('connect', EX.destinationReady.bind(null, ctx));
  ctx.destSock.on('close',  ctx.log.bind(null, 'upstream close, error?'));
};


EX.httpReply = function (ctx, code, msg) {
  msg = 'HTTP/1.1 ' + String(code) + ' ' +
    String(msg || EX.defaultHttpMessages[code]);
  ctx.log('reply: ' + msg);
  ctx.clntSock.write(msg + '\r\n\r\n');
  if (code !== 200) {
    ctx.clntSock.end();
    ctx.clntSock = null;
    /* cleanup remaining loose ends: */
    EX.abandonBothParties.call(ctx, null, new Error(msg));
  }
};


EX.destinationReady = function (ctx) {
  ctx.log('destination connected');
  ['clnt', 'dest'].forEach(function (side) {
    var sock = ctx[side + 'Sock'];
    /* make sure that we have no legacy attached to any side: */
    sock.removeAllListeners('data');
    sock.removeAllListeners('error');
    sock.removeAllListeners('connect');
    /* and establish the new phase: */
    sock.on('error', EX.abandonBothParties.bind(ctx, side));
    sock.setTimeout(0);
  });

  /* prepare to watch how they get along with each other */
  ctx.clntSock.on('data', EX.countBytes.bind(null, ctx, 'sent'));
  ctx.destSock.on('end', EX.oneSideQuit.bind(null, ctx, 'client', 'sent'));
  ctx.destSock.on('data', EX.countBytes.bind(null, ctx, 'rcvd'));
  ctx.destSock.on('end', EX.oneSideQuit.bind(null, ctx, 'upstream', 'rcvd'));

  /* now kiss */
  ctx.clntSock.pipe(ctx.destSock);
  EX.httpReply(ctx, 200);
  ctx.destSock.pipe(ctx.clntSock);
};


EX.countBytes = function (ctx, side, data) {
  ctx['byteCount_' + side] += data.length;
};


EX.oneSideQuit = function (ctx, sockName, side) {
  ctx.log(sockName + ' hung up, ' + String(ctx['byteCount_' + side]) +
    ' bytes ' + side + '.');
};






















if (require.main === module) { EX.runFromCLI(); }
