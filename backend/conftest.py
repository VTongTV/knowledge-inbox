"""test loader: keep the backend root on sys.path so tests import app.*"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
