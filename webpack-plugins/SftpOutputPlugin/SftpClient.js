const Client = require("ssh2").Client;
const osPath = require("path").posix;
const fs = require("fs");
const concat = require("concat-stream");

function forEachAsync(array, callback) {
  return array.reduce((promise, item) => {
    return promise.then(result => {
      return callback(item);
    });
  }, Promise.resolve());
}

let SftpClient = function() {
  this.client = new Client();
};

SftpClient.prototype.list = function(path) {
  const reg = /-/gi;
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) {
        reject(new Error(`Failed to list ${path}: ${err.message}`));
      } else {
        let newList = [];
        // reset file info
        if (list) {
          newList = list.map(item => {
            return {
              type: item.longname.substr(0, 1),
              name: item.filename,
              size: item.attrs.size,
              modifyTime: item.attrs.mtime * 1000,
              accessTime: item.attrs.atime * 1000,
              rights: {
                user: item.longname.substr(1, 3).replace(reg, ""),
                group: item.longname.substr(4, 3).replace(reg, ""),
                other: item.longname.substr(7, 3).replace(reg, "")
              },
              owner: item.attrs.uid,
              group: item.attrs.gid
            };
          });
        }
        resolve(newList);
      }
    });
    return undefined;
  });
};

SftpClient.prototype.exists = function(path) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    let { dir, base } = osPath.parse(path);
    sftp.readdir(dir, (err, list) => {
      if (err) {
        if (err.code === 2) {
          resolve(false);
        } else {
          reject(
            new Error(`Error listing ${dir}: code: ${err.code} ${err.message}`)
          );
        }
      } else {
        let [type] = list
          .filter(item => item.filename === base)
          .map(item => item.longname.substr(0, 1));
        if (type) {
          resolve(type);
        } else {
          resolve(false);
        }
      }
    });
    return undefined;
  });
};

SftpClient.prototype.stat = function(remotePath) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, function(err, stats) {
      if (err) {
        reject(new Error(`Failed to stat ${remotePath}: ${err.message}`));
      } else {
        // format similarly to sftp.list
        resolve({
          mode: stats.mode,
          permissions: stats.permissions,
          owner: stats.uid,
          group: stats.gid,
          size: stats.size,
          accessTime: stats.atime * 1000,
          modifyTime: stats.mtime * 1000
        });
      }
    });
    return undefined;
  });
};

SftpClient.prototype.get = function(path, dst, options) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    try {
      let rdr = sftp.createReadStream(path, options);

      rdr.on("error", err => {
        return reject(new Error(`Failed to get ${path}: ${err.message}`));
      });

      if (dst === undefined) {
        // no dst specified, return buffer of data
        let concatStream = concat(buff => {
          return resolve(buff);
        });
        rdr.pipe(concatStream);
      } else if (typeof dst === "string") {
        // dst local file path
        let wtr = fs.createWriteStream(dst);
        wtr.on("error", err => {
          return reject(new Error(`Failed get for ${path}: ${err.message}`));
        });
        wtr.on("finish", () => {
          return resolve(dst);
        });
        rdr.pipe(wtr);
      } else {
        // assume dst is a writeStream
        dst.on("finish", () => {
          return resolve(dst);
        });
        rdr.pipe(dst);
      }
    } catch (err) {
      this.client.removeListener("error", reject);
      return reject(new Error(`Failed get on ${path}: ${err.message}`));
    }
  });
};

SftpClient.prototype.fastGet = function(remotePath, localPath, options) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, options, function(err) {
      if (err) {
        reject(new Error(`Failed to get ${remotePath}: ${err.message}`));
      }
      resolve(`${remotePath} was successfully download to ${localPath}!`);
    });
    return undefined;
  });
};

SftpClient.prototype.fastPut = function(localPath, remotePath, options) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, options, function(err) {
      if (err) {
        reject(
          new Error(
            `Failed to upload ${localPath} to ${remotePath}: ${err.message}`
          )
        );
      }
      resolve(`${localPath} was successfully uploaded to ${remotePath}!`);
    });
    return undefined;
  });
};

SftpClient.prototype.put = function(input, remotePath, options) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    if (typeof input === "string") {
      sftp.fastPut(input, remotePath, options, err => {
        if (err) {
          return reject(
            new Error(
              `Failed to upload ${input} to ${remotePath}: ${err.message}`
            )
          );
        }
        return resolve(`Uploaded ${input} to ${remotePath}`);
      });
      return false;
    }
    let stream = sftp.createWriteStream(remotePath, options);

    stream.on("error", err => {
      return reject(
        new Error(
          `Failed to upload data stream to ${remotePath}: ${err.message}`
        )
      );
    });

    stream.on("finish", () => {
      return resolve(`Uploaded data stream to ${remotePath}`);
    });

    if (input instanceof Buffer) {
      stream.end(input);
      return false;
    }
    input.pipe(stream);
  });
};

SftpClient.prototype.append = function(input, remotePath, options) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    if (typeof input === "string") {
      throw new Error("Cannot append a file to another");
    }
    let stream = sftp.createWriteStream(remotePath, options);

    stream.on("error", err => {
      return reject(
        new Error(
          `Failed to upload data stream to ${remotePath}: ${err.message}`
        )
      );
    });

    stream.on("finish", () => {
      return resolve(`Uploaded data stream to ${remotePath}`);
    });

    if (input instanceof Buffer) {
      stream.end(input);
      return false;
    }
    input.pipe(stream);
  });
};

SftpClient.prototype.mkdir = function(path, recursive = false) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  let doMkdir = p => {
    return new Promise((resolve, reject) => {
      sftp.mkdir(p, err => {
        if (err && err.code !== 4) {
          reject(new Error(`Failed to create directory ${p}: ${err.message}`));
        }
        resolve(`${p} directory created`);
      });
      return undefined;
    });
  };

  return this.exists(path).then(type => {
    if (type === "d") return;
    if (type !== false) {
      return Promise.reject(new Error(`Failed to create directory ${path}`));
    }

    if (!recursive) {
      return doMkdir(path);
    }

    let mkdir = p => {
      let { dir } = osPath.parse(p);
      return this.exists(dir)
        .then(type => {
          if (type === false) {
            return mkdir(dir);
          } else if (type !== "d") {
            return Promise.reject(
              new Error(`Failed to create directory ${dir}`)
            );
          }
        })
        .then(() => {
          return doMkdir(p);
        });
    };

    return mkdir(path);
  });
};

SftpClient.prototype.rmdir = function(path, recursive = false) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  let doRmdir = p => {
    return new Promise((resolve, reject) => {
      sftp.rmdir(p, err => {
        if (err) {
          reject(new Error(`Failed to remove directory ${p}: ${err.message}`));
        }
        resolve("Successfully removed directory");
      });
      return undefined;
    });
  };

  return this.exists(path).then(type => {
    if (type === "d") {
      if (!recursive) {
        return doRmdir(path);
      }

      let rmdir = p => {
        let list;
        let files;
        let dirs;
        return this.list(p)
          .then(res => {
            list = res;
            files = list.filter(item => item.type === "-");
            dirs = list.filter(item => item.type === "d");
            return forEachAsync(files, f => {
              return this.delete(osPath.join(p, f.name));
            });
          })
          .then(() => {
            return forEachAsync(dirs, d => {
              return rmdir(osPath.join(p, d.name));
            });
          })
          .then(() => {
            return doRmdir(p);
          });
      };

      return rmdir(path);
    } else if (type === false) {
      return;
    } else {
      return Promise.reject(
        new Error(`${path} is not a directory, cannot be removed`)
      );
    }
  });
};

SftpClient.prototype.delete = function(path) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return this.exists(path).then(type => {
    if (type === "-") {
      return new Promise((resolve, reject) => {
        sftp.unlink(path, err => {
          if (err) {
            reject(new Error(`Failed to delete file ${path}: ${err.message}`));
          }
          resolve("Successfully deleted file");
        });
      });
    } else if (type === false) {
      return;
    } else {
      return Promise.reject("Failed: The file to delete was directory");
    }
  });
};

SftpClient.prototype.rename = function(srcPath, remotePath) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    sftp.rename(srcPath, remotePath, err => {
      if (err) {
        reject(
          new Error(
            `Failed to rename file ${srcPath} to ${remotePath}: ${err.message}`
          )
        );
      }
      resolve(`Successfully renamed ${srcPath} to ${remotePath}`);
    });
    return undefined;
  });
};

SftpClient.prototype.chmod = function(remotePath, mode) {
  let sftp = this.sftp;
  if (!sftp) {
    return Promise.reject(new Error("sftp connect error"));
  }

  return new Promise((resolve, reject) => {
    sftp.chmod(remotePath, mode, err => {
      if (err) {
        reject(
          new Error(`Failed to change mode for ${remotePath}: ${err.message}`)
        );
      }
      resolve("Successfully change file mode");
    });
    return undefined;
  });
};

SftpClient.prototype.connect = function(config, connectMethod) {
  connectMethod = connectMethod || "on";

  return new Promise((resolve, reject) => {
    this.client[connectMethod]("ready", () => {
      this.client.sftp((err, sftp) => {
        this.client.removeListener("error", reject);
        this.client.removeListener("end", reject);
        if (err) {
          reject(new Error(`Failed to connect to server: ${err.message}`));
        }
        this.sftp = sftp;
        resolve(sftp);
      });
    })
      .on("end", reject)
      .on("error", reject)
      .connect(config);
  });
};

SftpClient.prototype.end = function() {
  return new Promise(resolve => {
    this.client.end();
    resolve();
  });
};

SftpClient.prototype.on = function(eventType, callback) {
  this.client.on(eventType, callback);
};

module.exports = SftpClient;
