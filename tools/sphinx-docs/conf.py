# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import os
import sys
sys.path.insert(0, os.path.abspath('../../custom_components')) # Adjust path to find marees_france

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = 'Marées France Integration'
copyright = '2025, The Marées France Authors'
author = 'The Marées France Authors'

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.napoleon',  # For Google and NumPy style docstrings
    'sphinx.ext.viewcode',  # To add links to source code
    'sphinx.ext.intersphinx', # To link to other projects' documentation
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

# Napoleon settings (for Google style docstrings)
napoleon_google_docstring = True
napoleon_numpy_docstring = False # Or True if you use NumPy style
napoleon_include_init_with_doc = True
napoleon_include_private_with_doc = False
napoleon_include_special_with_doc = True
napoleon_use_admonition_for_examples = False
napoleon_use_admonition_for_notes = False
napoleon_use_admonition_for_references = False
napoleon_use_ivar = False
napoleon_use_param = True
napoleon_use_rtype = True
napoleon_preprocess_types = False
napoleon_type_aliases = None
napoleon_attr_annotations = True

# Intersphinx mapping
intersphinx_mapping = {
    'python': ('https://docs.python.org/3', None),
    # 'homeassistant': ('https://developers.home-assistant.io/en/latest/', None), # Commented out as objects.inv may not be available
    # Add other mappings if needed, e.g., for aiohttp
    # 'aiohttp': ('https://docs.aiohttp.org/en/stable/', None),
}

# Autodoc settings
autodoc_member_order = 'bysource' # Order members by source order
autodoc_default_options = {
    'members': True,
    'undoc-members': True, # Include members without docstrings (though we aim for full coverage)
    'show-inheritance': True,
}
# autodoc_typehints = "description" # Show typehints in the description (requires Sphinx 4.0+)
# If using older Sphinx, you might need sphinx_autodoc_typehints extension

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_theme = 'sphinx_rtd_theme'
html_static_path = ['_static']

# If you have a logo:
# html_logo = "_static/logo.png"

# Theme options are theme-specific
html_theme_options = {
    'collapse_navigation': False,
    'sticky_navigation': True,
    'navigation_depth': 4,
    'includehidden': True,
    'titles_only': False
}

# Add any custom CSS files (optional)
# def setup(app):
#     app.add_css_file('custom.css')
