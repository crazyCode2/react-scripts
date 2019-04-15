const path = require("path");
const pathJoin = require("path.join");
const Client = require("./SftpClient");

function relative(p1, p2) {
  return path.relative(p1, p2).replace(/\\/g, "/") || ".";
}

function SftpOutputFileSystem(options, old) {
  this.options = options;
  this.outputPath = this.options.outputPath;
  this.localOutputPath = this.options.localOutputPath;
  this.old = old;
  delete this.options.outputPath;
  delete this.options.localOutputPath;
  this.client = new Client();
  this.connection = this.client
    .connect(options)
    .then(() => this.client.rmdir(this.outputPath, true));
}

function ensureConnected(methodName) {
  return fn =>
    function() {
      const args = [].slice.call(arguments, 0, arguments.length - 1);
      const callback = arguments[arguments.length - 1];

      let called = false;
      const onceCallback = function() {
        if (!called) {
          called = true;
          callback.apply(this, arguments);
        }
      };

      this.old[methodName].apply(
        this.old,
        args.concat([err => err && onceCallback(err)])
      );

      this.connection
        .then(() => fn.apply(this, args))
        .then(() => onceCallback())
        .catch(err => onceCallback(err));
    };
}

SftpOutputFileSystem.prototype.getOutputPath = function(p) {
  return pathJoin(this.outputPath || "/", relative(this.localOutputPath, p));
};

SftpOutputFileSystem.prototype.mkdirp = ensureConnected("mkdirp")(function(
  path
) {
  return this.client.mkdir(this.getOutputPath(path), true);
});

SftpOutputFileSystem.prototype.mkdir = ensureConnected("mkdir")(function(path) {
  return this.client.mkdir(this.getOutputPath(path), false);
});

SftpOutputFileSystem.prototype.rmdir = ensureConnected("rmdir")(function(path) {
  return this.client.rmdir(this.getOutputPath(path), true);
});

SftpOutputFileSystem.prototype.unlink = ensureConnected("unlink")(function(
  path
) {
  return this.client.delete(this.getOutputPath(path));
});

SftpOutputFileSystem.prototype.writeFile = ensureConnected("writeFile")(
  function(file, data) {
    if (!Buffer.isBuffer(data)) {
      data = new Buffer(data, "utf8");
    }
    return this.client.put(data, this.getOutputPath(file));
  }
);

SftpOutputFileSystem.prototype.join = pathJoin;

module.exports = SftpOutputFileSystem;
