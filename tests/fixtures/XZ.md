XZ fixtures are generated independently by Python's standard-library `lzma`
(liblzma), not by SeaSubs. Run `python tests/fixtures/generate-xz.py` to regenerate.
Python is not needed to run the tests.

`xz-subtitle.ass` is synthetic UTF-8 ASS. Each `xz-{crc32,crc64,sha256}.ass.xz`
decodes to that exact text. The `-multi` variants split the same text into two
independently compressed blocks, with an index and footer rebuilt by the generator
and verified with liblzma. Tests mutate each check byte in both blocks, padding,
and structural CRCs. The other fixtures exercise the existing 2 MiB output
and 16-block limits. The former dictionary-limit fixture is now named
`xz-dictionary-16m.xz`: its valid 16 MiB declaration must decode successfully.

`-dict64` variants reproduce the 64 MiB declaration (property 28) seen in all
four reported Yomi no Tsugai/Daemons Episode 5 attachments. They use independently
compressed liblzma data with a larger dictionary declaration and a recomputed
Block Header CRC; liblzma verifies the result. `-dictmax` variants declare the
maximum legal dictionary (property 40). Runtime tests enforce bounded allocation
without allocating the declared 4 GiB. Data checks are unchanged and verified.
These are synthetic regression fixtures, not captured episode subtitles.
