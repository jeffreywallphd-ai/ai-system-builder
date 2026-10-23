@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Native Command Prompt launcher. No install, download or policy changes.
rem --all-blocked selects the reviewed complete bundle; default diagnostics stay compatible.
for %%I in ("%~dp0..\..\..") do set "AISB_MODEL_ROOT=%%~fI"
if not defined AISB_MODEL_TEST_PYTHON set "AISB_MODEL_TEST_PYTHON=%AISB_MODEL_ROOT%\artifacts\tmp\lancedb-python312-ai-runtime\Scripts\python.exe"
if not exist "%AISB_MODEL_TEST_PYTHON%" goto missing_python
where node >nul 2>&1
if errorlevel 1 if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto missing_node
set "PYTHONNOUSERSITE=1"
"%AISB_MODEL_TEST_PYTHON%" -s -B "%~dp0run_standalone_model_tests.py" --run %*
exit /b %ERRORLEVEL%

:missing_python
echo Existing AI Python runtime unavailable. Set AISB_MODEL_TEST_PYTHON to an already prepared python.exe. Nothing was installed. 1>&2
exit /b 1

:missing_node
echo Node is required to record the source identity. Add the existing Node runtime to PATH. Nothing was installed. 1>&2
exit /b 1
