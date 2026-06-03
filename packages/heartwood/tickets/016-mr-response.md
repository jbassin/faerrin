id: 016
title: mr-response
parent: 001
type: task
author: jbassin
---

## Overview
The stakeholders have a new request -- they'd like to be able to leave comments on the MR in gitlab and have them applied by the llm.

### Details

There are two places where they would like to be able to leave comments:
  - Each of the speculative comments: they would like to be able to leave a response to the comment, saying if it should be approved or denied. If it gets approved, then an edit should be made to the mr adding it in.
  - Comments on the changes themselves. Sometimes a change gets through that should be under a different name, or merged into another document, or deleted entirely since it's unnecessary. They should be able to leave a comment on a file or line, and the comment should be addressed.

There should be a new command line command that kicks off the response to the mr review.
