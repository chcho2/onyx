export default function authenticate(
  onyx: any,
  name: string | Array<string>,
  options?: any,
  callback?: Function
) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  // 11.10 *resolved* if neither options nor callback were passed in, we still want to define options as an empty object
  options = options || {};

  let multi = true;

  console.log('in authenticate middleware line 14');
  // ref: passport/lib/middleware/authenticate.js line 84
  // ex: name = ['basic', 'digest', 'token']
  if (!Array.isArray(name)) {
    name = [name];
    multi = false;
  }

  // passport.authenticate(new LocalStrategy())

  // 11.8 going through the names array, taking out each strategy, adding on the 'action functions', and then invoking the strategy.authenticate
  return async function authenticate(context: any, next?: Function) {
    interface failureObj {
      challenge: any;
      status?: number;
    }
    const failures: Array<failureObj> = [];

    // if every strategy failed, invoke the callback if developer provided as an argument when invoking onyx.authenticate('strategyName', cb)
    async function allFailed() {
      console.log(`in allFailed`);
      if (callback) {
        if (!multi) {
          // not sure if return or await so if needed, will come back 11.8
          return callback(
            null,
            false,
            failures[0].challenge,
            failures[0].status
          );
        } else {
          const challenges = failures.map((failure) => failure.challenge);
          const statuses = failures.map((failure) => failure.status);
          return callback(null, false, challenges, statuses);
        }
      }

      let msg: string;
      const failure: failureObj = failures[0] || {};

      let challenge: any = failure.challenge || {};
      if (options.failureMessage) {
        if (typeof options.failureMessage === 'boolean') {
          msg = challenge.message || challenge;
        } else msg = options.failureMessage;
        if (!context.state.onyx.session.message) {
          context.state.onyx.session.message = [];
        }
        context.state.onyx.session.message.push(msg);
      }

      if (options.failureRedirect) {
        context.response.redirect(options.failureRedirect);
      }

      const rchallenge: Array<string> = [];
      let rstatus: undefined | number;

      failures.forEach((failure) => {
        const challenge = failure.challenge;
        const status = failure.status;

        rstatus = rstatus || status;

        // 11.8 *note* what happens if challenge is an object?
        if (typeof challenge === 'string') {
          rchallenge.push(challenge);
        }
      });
      context.response.status = rstatus || 401;
      if (context.response.status === 401 && rchallenge.length) {
        context.response.headers.set('WWW-Authenticate', rchallenge);
      }

      // options.failWithError not implemented
    } // end of allFailed function

    // going through the name array, getting the strategy from onyx._strategy, and adding on the action functions
    await (async function attempt(i) {
      console.log(
        `in authenticate middleware, attempt #${i} with onyx._strategies ${onyx._strategies[i]}`
      );
      const layer = name[i];
      // 11.8 *note* might need await
      if (!layer) return allFailed();

      // 11.8 In passport, used const prototype = onyx._strategy(layer), not sure, same as onyx._strategies[layer]
      const prototype = onyx._strategies[layer];

      if (!prototype) {
        return context.throw(
          new Error(`Unknown authentication strategy ${layer}`)
        );
      }

      const strategy = Object.create(prototype);
      console.log('prototype is', prototype);
      console.log('strategy is', strategy);
      console.log('strategy has __proto__', Object.getPrototypeOf(strategy));

      strategy.funcs.success = async function (user: object, info?: any) {
        console.log('in authenticate .success()');
        if (callback) return callback(null, user, info);

        info = info || {};
        let msg;

        if (options?.successMessage) {
          if (typeof options.successMessage === 'boolean') {
            msg = info.message || info;
          } else msg = options.successMessage;
          if (typeof msg === 'string') {
            context.state.onyx.session.message =
              context.state.onyx.session.message || [];
            context.state.onyx.session.message.push(msg);
          }
        }
        // options.assignProperty, onyx.authorize()

        // request // req.login
        // const session: boolean =
        //   options.session === undefined ? true : options.session;

        // if (session) {
        //   if (context.state.onyx) throw new Error('onyx.initialize() middleware not in use')
        //   if ()
        // }

        await context.state.logIn(context, user, onyx, async function (
          err: any
        ) {
          if (err) {
            throw new Error(err);
          }

          async function complete() {
            if (options.successRedirect) {
              return context.response.redirect(options.successRedirect);
            }
            next && (await next());
          }

          // if (options.authInfo !== false) {
          //   //transformAuthInfo
          // }
          console.log('in cb of logIn, options is', options);
          await complete();
        });
      }; // end of success function

      strategy.funcs.fail = async function (challenge: any, status?: number) {
        if (typeof challenge === 'number') {
          status = challenge;
          challenge = undefined;
        }
        console.log(`in fail with challenge ${challenge} and status ${status}`);
        failures.push({ challenge, status });
        attempt(i + 1);
      };

      // for anonymous
      strategy.funcs.pass = async function () {
        next && (await next());
      };

      strategy.funcs.error = async function (err: any) {
        if (callback) {
          return callback(err);
        }
        next && (await next());
      };

      console.log(
        'in authenticate middleware, strategy has the following properties',
        Object.keys(strategy)
      );

      await strategy.authenticate(context, options);
      console.log(
        'in authenticate middleware, local-strategy.authenticate has completed'
      );
    })(0);
  };
}
