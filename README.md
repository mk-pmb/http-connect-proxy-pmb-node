
<!--#echo json="package.json" key="name" underline="=" -->
http-connect-proxy-pmb
======================
<!--/#echo -->

<!--#echo json="package.json" key="description" -->
A simple HTTP CONNECT proxy.
<!--/#echo -->


Usage
-----

```bash
$ nodejs hcp.js
```


Config options
--------------

They're to be set as environment variables.

* `HCP_PORT`: Which TCP port to listen on.
* `HCP_BIND`: Which network interface (hostname or IP) to listen on.
  Default: `localhost`

<!--#toc stop="scan" -->



Known issues
------------

* Needs more/better tests and docs.




&nbsp;

  [wpen-hpkp]: https://en.wikipedia.org/wiki/HTTP_Public_Key_Pinning
  [wpen-hsts]: https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security
  [moz-hpkp]: https://wiki.mozilla.org/SecurityEngineering/Public_Key_Pinning

License
-------
<!--#echo json="package.json" key=".license" -->
ISC
<!--/#echo -->
