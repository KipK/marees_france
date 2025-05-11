#!/bin/bash
echo "Setting up the environment..."
echo "Installing Node.js dependencies..."
npm install
cd frontend && npm install
cd ..
echo "Installing Python dependencies..."
pip install -r requirements.txt
pip install -r tools/sphinx-docs/requirements.txt