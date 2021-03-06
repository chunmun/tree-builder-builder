 # Copyright 2015 Google Inc. All rights reserved.
 #
 # Licensed under the Apache License, Version 2.0 (the "License");
 # you may not use this file except in compliance with the License.
 # You may obtain a copy of the License at
 #
 #   http://www.apache.org/licenses/LICENSE-2.0
 #
 # Unless required by applicable law or agreed to in writing, software
 # distributed under the License is distributed on an "AS IS" BASIS,
 # WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 # See the License for the specific language governing permissions and
 # limitations under the License

import telemetry.core
import sys;
from telemetry.core import browser_options
from telemetry.core import browser_finder

from telemetry.core.platform import tracing_category_filter
from telemetry.core.platform import tracing_options

from json import dumps

options = browser_options.BrowserFinderOptions();
parser = options.CreateParser();
(_, args) = parser.parse_args();

browserFactory = browser_finder.FindBrowser(options);

with browserFactory.Create(options) as browser:
  tab = browser.tabs.New();
  tab.Activate();
  for i in browser.tabs:
    if i == tab.id:
      continue
    browser.tabs.GetTabById(i).Close()

  category_filter = tracing_category_filter.TracingCategoryFilter()
  options = tracing_options.TracingOptions()
  options.enable_chrome_trace = True
  tab.Navigate(args[0]);
  tab.WaitForDocumentReadyStateToBeComplete();
  oldDisplay = tab.EvaluateJavaScript("document.documentElement.style.display");
  browser.platform.tracing_controller.Start(options, category_filter);
  iterations = 1
  if len(args) == 2:
    iterations = int(args[1])
  for i in range(iterations):
    tab.EvaluateJavaScript("(function() { document.documentElement.style.display = 'none'; return document.documentElement.offsetTop; })()");
    tab.EvaluateJavaScript("(function() { document.documentElement.style.display = '" + oldDisplay + "'; console.time('iteration" + str(i) + 
      "'); var x = document.documentElement.offsetTop; console.timeEnd('iteration" + str(i) + "'); })()");
  browser.platform.tracing_controller.Stop().Serialize(sys.stdout);
