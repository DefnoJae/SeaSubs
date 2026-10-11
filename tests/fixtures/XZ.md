XZ fixtures are generated independently by Python's standard-library `lzma`
(liblzma), not by SeaSubs. Run `python tests/fixtures/generate-xz.py` to regenerate.
Python is not needed to run the tests.

`xz-subtitle.ass` is synthetic UTF-8 ASS. Each `xz-{crc32,crc64,sha256}.ass.xz`
decodes to that exact text. The `-multi` variants split the same text into two
independently compressed blocks, with an index and footer rebuilt by the generator
and verified with liblzma. Tests mutate each check byte in both blocks, padding,
and structural CRCs. The other fixtures exercise the existing 2 MiB output,
8 MiB dictionary and 16-block limits. These are synthetic regression fixtures,
not captured Slime attachments.
