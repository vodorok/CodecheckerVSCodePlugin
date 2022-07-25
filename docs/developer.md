# Developer docs

This is a how to guide about building and deploying the plugin.

## Requirements

- Node version manager <sup>*</sup>
- Node.js (v12.x+)
- Yarn (v1.x+)

*Not strictly necessary, but makes life easier*

### Installing requirements

The most flexible way to install `npm` is to use the [Node Verson Manager](https://github.com/nvm-sh/nvm).
Run one of the following command to install 
(the detailed steps of `nvm` installation can be found [here](https://github.com/nvm-sh/nvm#installing-and-updating).)

```curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash```

```wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash```


With the help of `nvm`, install `npm` by running the following command. This will install the long-term support version.

```
nvm install --lts
```

Make sure to set the newly installed `NodeJS` version to be used.

```
nvm use --lts
```

As an optional step, this newly installed version of `NodeJS` can be aliased to be used as default.

```
nvm alias default lts/*
```

To be able to build the project, `yarn` needs to be added to `NodeJS`

```
npm install --global yarn
```

## Development

The recommended development environment is VS Code itself.
Recommended VS Code extensions are:
 - ESLint
 - TypeScript+Webpack Problem Matcher

The structure of the projet is documented in the architecture.md.

### Building the project

To build the extension the extension from the command line, run the following:

`
yarn compile
`

The following command will create the usable extension

`
yarn run vsce package
`

To install the dependencies, run
`yarn install --frozen-lockfile`

### Debugging

Open VS Code in the root of the project folder.

`code .`

Select `Run Extension`.
Press F5 to start debugging.

### Testing

To run tests, select `Extension Tests` as the active debug configuration in VS Code.
From the command line, run.

`yarn run test`

## Deployment

The deployment workfolw is based on the following [documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
The deployment and relase of the extension is done through Github, with the [Deploy workflow](https://github.com/Ericsson/CodecheckerVSCodePlugin/actions/workflows/deploy.yml).

