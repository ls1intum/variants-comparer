# data

This folder is used by the server to store all cloned repositories and generated files.

- The folder is mounted into the server container at `/data`.
- Each exercise or variant will be created under this directory, e.g. `/data/exam-variants/<exercise>/<variant>`.
- The server ensures folders are created automatically when needed.

Notes and recommendations:
- This folder is deliberately excluded from version control to avoid accidentally committing student submissions and other sensitive data.
- To keep a placeholder and documentation inside the repository, this README and `.gitkeep` are included.
- Be careful not to commit credentials or sensitive data from cloned repositories.

If you need to reset the data folder, stop the container and delete the files in this directory. The server will re-create the structure as required.