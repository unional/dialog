import {customAttribute,customElement,inlineView,bindable,CompositionEngine,ViewSlot} from 'aurelia-templating';
import {DOM} from 'aurelia-pal';
import {transient,Container} from 'aurelia-dependency-injection';
import {Origin} from 'aurelia-metadata';

/**
 * An abstract base class for implementors of the basic Renderer API.
 */
export class Renderer {
  /**
   * Gets an anchor for the ViewSlot to insert a view into.
   * @returns A DOM element.
   */
  getDialogContainer(): any {
    throw new Error('DialogRenderer must implement getDialogContainer().');
  }

  /**
   * Displays the dialog.
   * @returns Promise A promise that resolves when the dialog has been displayed.
   */
  showDialog(dialogController: DialogController): Promise<any> {
    throw new Error('DialogRenderer must implement showDialog().');
  }

  /**
   * Hides the dialog.
   * @returns Promise A promise that resolves when the dialog has been hidden.
   */
  hideDialog(dialogController: DialogController): Promise<any> {
    throw new Error('DialogRenderer must implement hideDialog().');
  }
}

/**
 * Call a lifecycle method on a viewModel if it exists.
 * @function
 * @param instance The viewModel instance.
 * @param name The lifecycle method name.
 * @param model The model to pass to the lifecycle method.
 * @returns Promise The result of the lifecycle method.
 */
export function invokeLifecycle(instance: any, name: string, model: any) {
  if (typeof instance[name] === 'function') {
    let result = instance[name](model);

    if (result instanceof Promise) {
      return result;
    }

    if (result !== null && result !== undefined) {
      return Promise.resolve(result);
    }

    return Promise.resolve(true);
  }

  return Promise.resolve(true);
}

@customAttribute('attach-focus')
export class AttachFocus {
  static inject = [Element];

  value = true;

  constructor(element) {
    this.element = element;
  }

  attached() {
    if (this.value && this.value !== 'false') {
      this.element.focus();
    }
  }

  valueChanged(newValue) {
    this.value = newValue;
  }
}


@customElement('ai-dialog')
@inlineView(`
  <template>
    <slot></slot>
  </template>
`)
export class AiDialog {

}

@customElement('ai-dialog-body')
@inlineView(`
  <template>
    <slot></slot>
  </template>
`)
export class AiDialogBody {

}

/**
 * The result of a dialog open operation.
 */
export class DialogResult {
  /**
   * Indicates whether or not the dialog was cancelled.
   */
  wasCancelled: boolean = false;

  /**
   * The data returned from the dialog.
   */
  output: any;

  /**
   * Creates an instance of DialogResult (Used Internally)
   */
  constructor(cancelled: boolean, output: any) {
    this.wasCancelled = cancelled;
    this.output = output;
  }
}

export let dialogOptions = {
  lock: true,
  centerHorizontalOnly: false,
  startingZIndex: 1000
};

/**
 * A controller object for a Dialog instance.
 */
export class DialogController {
  /**
   * The settings used by this controller.
   */
  settings: any;

  /**
   * Creates an instance of DialogController.
   */
  constructor(renderer: DialogRenderer, settings: any, resolve: Function, reject: Function) {
    let defaultSettings = renderer ? renderer.defaultSettings || {} : {};

    this.renderer = renderer;
    this.settings = Object.assign({}, defaultSettings, settings);
    this._resolve = resolve;
    this._reject = reject;
  }

  /**
   * Closes the dialog with a successful output.
   * @param output The returned success output.
   */
  ok(output?: any): Promise<DialogResult> {
    return this.close(true, output);
  }

  /**
   * Closes the dialog with a cancel output.
   * @param output The returned cancel output.
   */
  cancel(output?: any): Promise<DialogResult> {
    return this.close(false, output);
  }

  /**
   * Closes the dialog with an error result.
   * @param message An error message.
   * @returns Promise An empty promise object.
   */
  error(message: any): Promise<void> {
    return invokeLifecycle(this.viewModel, 'deactivate')
      .then(() => {
        return this.renderer.hideDialog(this);
      }).then(() => {
        this.controller.unbind();
        this._reject(message);
      });
  }

  /**
   * Closes the dialog.
   * @param ok Whether or not the user input signified success.
   * @param output The specified output.
   * @returns Promise An empty promise object.
   */
  close(ok: boolean, output?: any): Promise<DialogResult> {
    return invokeLifecycle(this.viewModel, 'canDeactivate').then(canDeactivate => {
      if (canDeactivate) {
        return invokeLifecycle(this.viewModel, 'deactivate')
          .then(() => {
            return this.renderer.hideDialog(this);
          }).then(() => {
            let result = new DialogResult(!ok, output);
            this.controller.unbind();
            this._resolve(result);
            return result;
          });
      }

      return Promise.resolve();
    });
  }
}

let containerTagName = 'ai-dialog-container';
let overlayTagName = 'ai-dialog-overlay';
let transitionEvent = (function() {
  let transition = null;

  return function() {
    if (transition) return transition;

    let t;
    let el = DOM.createElement('fakeelement');
    let transitions = {
      'transition': 'transitionend',
      'OTransition': 'oTransitionEnd',
      'MozTransition': 'transitionend',
      'WebkitTransition': 'webkitTransitionEnd'
    };
    for (t in transitions) {
      if (el.style[t] !== undefined) {
        transition = transitions[t];
        return transition;
      }
    }
  };
}());

@transient()
export class DialogRenderer {
  dialogControllers = [];
  escapeKeyEvent = (e) => {
    if (e.keyCode === 27) {
      let top = this.dialogControllers[this.dialogControllers.length - 1];
      if (top && top.settings.lock !== true) {
        top.cancel();
      }
    }
  };

  constructor() {
    this.defaultSettings = dialogOptions;
  }

  getDialogContainer() {
    return DOM.createElement('div');
  }

  showDialog(dialogController: DialogController) {
    if (!dialogController.showDialog) {
      return this._createDialogHost(dialogController).then(() => {
        return dialogController.showDialog();
      });
    }
    return dialogController.showDialog();
  }

  hideDialog(dialogController: DialogController) {
    return dialogController.hideDialog().then(() => {
      return dialogController.destroyDialogHost();
    });
  }

  _createDialogHost(dialogController: DialogController) {
    let settings = dialogController.settings;
    let modalOverlay = DOM.createElement(overlayTagName);
    let modalContainer = DOM.createElement(containerTagName);
    let wrapper = document.createElement('div');
    let anchor = dialogController.slot.anchor;
    wrapper.appendChild(anchor);
    modalContainer.appendChild(wrapper);
    let body = DOM.querySelectorAll('body')[0];
    let closeModalClick = (e) => {
      if (!settings.lock && !e._aureliaDialogHostClicked) {
        dialogController.cancel();
      } else {
        return false;
      }
    };

    let stopPropagation = (e) => { e._aureliaDialogHostClicked = true; };

    dialogController.showDialog = (() => {
      let promise;

      return () => {
        if (promise) return promise;

        if (!this.dialogControllers.length) {
          DOM.addEventListener('keyup', this.escapeKeyEvent);
        }

        this.dialogControllers.push(dialogController);

        dialogController.slot.attached();

        if (typeof settings.position === 'function') {
          settings.position(modalContainer, modalOverlay);
        } else {
          dialogController.centerDialog();
        }

        modalContainer.addEventListener('click', closeModalClick);
        anchor.addEventListener('click', stopPropagation);

        promise = new Promise((resolve) => {
          modalContainer.addEventListener(transitionEvent(), onTransitionEnd);

          function onTransitionEnd(e) {
            if (e.target !== modalContainer) {
              return;
            }
            modalContainer.removeEventListener(transitionEvent(), onTransitionEnd);
            resolve();
          }

          modalOverlay.classList.add('active');
          modalContainer.classList.add('active');
          body.classList.add('ai-dialog-open');
        });

        return promise;
      };
    })();

    dialogController.hideDialog = (() => {
      let promise;

      return () => {
        modalContainer.removeEventListener('click', closeModalClick);
        anchor.removeEventListener('click', stopPropagation);

        let i = this.dialogControllers.indexOf(dialogController);
        if (i !== -1) {
          this.dialogControllers.splice(i, 1);
        }

        if (!this.dialogControllers.length) {
          DOM.removeEventListener('keyup', this.escapeKeyEvent);
        }

        promise = new Promise((resolve) => {
          modalContainer.addEventListener(transitionEvent(), onTransitionEnd);

          function onTransitionEnd() {
            modalContainer.removeEventListener(transitionEvent(), onTransitionEnd);
            resolve();
          }

          modalOverlay.classList.remove('active');
          modalContainer.classList.remove('active');

          if (!this.dialogControllers.length) {
            body.classList.remove('ai-dialog-open');
          }
        });

        return promise;
      };
    })();

    dialogController.centerDialog = () => {
      if (settings.centerHorizontalOnly) return;
      centerDialog(modalContainer);
    };

    dialogController.destroyDialogHost = (() => {
      let promise;

      return () => {
        if (promise) return promise;

        body.removeChild(modalOverlay);
        body.removeChild(modalContainer);
        dialogController.slot.detached();
        promise = Promise.resolve();

        return promise;
      };
    })();

    modalOverlay.style.zIndex = this.defaultSettings.startingZIndex;
    modalContainer.style.zIndex = this.defaultSettings.startingZIndex;

    let lastContainer = Array.from(body.querySelectorAll(containerTagName)).pop();

    if (lastContainer) {
      lastContainer.parentNode.insertBefore(modalContainer, lastContainer.nextSibling);
      lastContainer.parentNode.insertBefore(modalOverlay, lastContainer.nextSibling);
    } else {
      body.insertBefore(modalContainer, body.firstChild);
      body.insertBefore(modalOverlay, body.firstChild);
    }

    return Promise.resolve();
  }
}

function centerDialog(modalContainer) {
  const child = modalContainer.children[0];
  const vh = Math.max(DOM.querySelectorAll('html')[0].clientHeight, window.innerHeight || 0);

  child.style.marginTop = Math.max((vh - child.offsetHeight) / 2, 30) + 'px';
  child.style.marginBottom = Math.max((vh - child.offsetHeight) / 2, 30) + 'px';
}

/**
 * * View-model for footer of Dialog.
 * */
@customElement('ai-dialog-footer')
@inlineView(`
  <template>
    <slot></slot>

    <template if.bind="buttons.length > 0">
      <button type="button" class="btn btn-default" repeat.for="button of buttons" click.trigger="close(button)">\${button}</button>
    </template>
  </template>
`)
export class AiDialogFooter {
  static inject = [DialogController];

  @bindable buttons: any[] = [];
  @bindable useDefaultButtons: boolean = false;

  constructor(controller: DialogController) {
    this.controller = controller;
  }

  close(buttonValue: string) {
    if (AiDialogFooter.isCancelButton(buttonValue)) {
      this.controller.cancel(buttonValue);
    } else {
      this.controller.ok(buttonValue);
    }
  }

  useDefaultButtonsChanged(newValue: boolean) {
    if (newValue) {
      this.buttons = ['Cancel', 'Ok'];
    }
  }

  static isCancelButton(value: string) {
    return value === 'Cancel';
  }
}

@customElement('ai-dialog-header')
@inlineView(`
  <template>
    <button type="button" class="dialog-close" aria-label="Close" if.bind="!controller.settings.lock" click.trigger="controller.cancel()">
      <span aria-hidden="true">&times;</span>
    </button>

    <div class="dialog-header-content">
      <slot></slot>
    </div>
  </template>
`)
export class AiDialogHeader {
  static inject = [DialogController];

  constructor(controller) {
    this.controller = controller;
  }
}

/**
 * A service allowing for the creation of dialogs.
 */
export class DialogService {
  static inject = [Container, CompositionEngine];

  constructor(container: Container, compositionEngine: CompositionEngine) {
    this.container = container;
    this.compositionEngine = compositionEngine;
    this.controllers = [];
    this.hasActiveDialog = false;
  }

  /**
   * Opens a new dialog.
   * @param settings Dialog settings for this dialog instance.
   * @return Promise A promise that settles when the dialog is closed.
   */
  open(settings?: Object): Promise<DialogResult> {
    let dialogController;

    let promise = new Promise((resolve, reject) => {
      let childContainer = this.container.createChild();
      dialogController = new DialogController(childContainer.get(Renderer), settings, resolve, reject);
      childContainer.registerInstance(DialogController, dialogController);
      let host = dialogController.renderer.getDialogContainer();

      let instruction = {
        container: this.container,
        childContainer: childContainer,
        model: dialogController.settings.model,
        viewModel: dialogController.settings.viewModel,
        viewSlot: new ViewSlot(host, true),
        host: host
      };

      return _getViewModel(instruction, this.compositionEngine).then(returnedInstruction => {
        dialogController.viewModel = returnedInstruction.viewModel;
        dialogController.slot = returnedInstruction.viewSlot;

        return invokeLifecycle(dialogController.viewModel, 'canActivate', dialogController.settings.model).then(canActivate => {
          if (canActivate) {
            this.controllers.push(dialogController);
            this.hasActiveDialog = !!this.controllers.length;

            return this.compositionEngine.compose(returnedInstruction).then(controller => {
              dialogController.controller = controller;
              dialogController.view = controller.view;

              return dialogController.renderer.showDialog(dialogController);
            });
          }
        });
      });
    });

    return promise.then((result) => {
      let i = this.controllers.indexOf(dialogController);
      if (i !== -1) {
        this.controllers.splice(i, 1);
        this.hasActiveDialog = !!this.controllers.length;
      }

      return result;
    });
  }
}

function _getViewModel(instruction, compositionEngine) {
  if (typeof instruction.viewModel === 'function') {
    instruction.viewModel = Origin.get(instruction.viewModel).moduleId;
  }

  if (typeof instruction.viewModel === 'string') {
    return compositionEngine.ensureViewModel(instruction);
  }

  return Promise.resolve(instruction);
}

let defaultRenderer = DialogRenderer;

let resources = {
  'ai-dialog': './ai-dialog',
  'ai-dialog-header': './ai-dialog-header',
  'ai-dialog-body': './ai-dialog-body',
  'ai-dialog-footer': './ai-dialog-footer',
  'attach-focus': './attach-focus'
};

let defaultCSSText = `ai-dialog-container,ai-dialog-overlay{position:fixed;top:0;right:0;bottom:0;left:0}ai-dialog,ai-dialog-container>div>div{min-width:300px;margin:auto;display:block}ai-dialog-overlay{opacity:0}ai-dialog-overlay.active{opacity:1}ai-dialog-container{display:block;transition:opacity .2s linear;opacity:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}ai-dialog-container.active{opacity:1}ai-dialog-container>div{padding:30px}ai-dialog-container>div>div{width:-moz-fit-content;width:-webkit-fit-content;width:fit-content;height:-moz-fit-content;height:-webkit-fit-content;height:fit-content}ai-dialog-container,ai-dialog-container>div,ai-dialog-container>div>div{outline:0}ai-dialog{box-shadow:0 5px 15px rgba(0,0,0,.5);border:1px solid rgba(0,0,0,.2);border-radius:5px;padding:3;width:-moz-fit-content;width:-webkit-fit-content;width:fit-content;height:-moz-fit-content;height:-webkit-fit-content;height:fit-content;border-image-source:initial;border-image-slice:initial;border-image-width:initial;border-image-outset:initial;border-image-repeat:initial;background:#fff}ai-dialog>ai-dialog-header{display:block;padding:16px;border-bottom:1px solid #e5e5e5}ai-dialog>ai-dialog-header>button{float:right;border:none;display:block;width:32px;height:32px;background:0 0;font-size:22px;line-height:16px;margin:-14px -16px 0 0;padding:0;cursor:pointer}ai-dialog>ai-dialog-body{display:block;padding:16px}ai-dialog>ai-dialog-footer{display:block;padding:6px;border-top:1px solid #e5e5e5;text-align:right}ai-dialog>ai-dialog-footer button{color:#333;background-color:#fff;padding:6px 12px;font-size:14px;text-align:center;white-space:nowrap;vertical-align:middle;-ms-touch-action:manipulation;touch-action:manipulation;cursor:pointer;background-image:none;border:1px solid #ccc;border-radius:4px;margin:5px 0 5px 5px}ai-dialog>ai-dialog-footer button:disabled{cursor:default;opacity:.45}ai-dialog>ai-dialog-footer button:hover:enabled{color:#333;background-color:#e6e6e6;border-color:#adadad}.ai-dialog-open{overflow:hidden}`;

/**
 * A configuration builder for the dialog plugin.
 */
export class DialogConfiguration {
  constructor(aurelia) {
    this.aurelia = aurelia;
    this.settings = dialogOptions;
    this.resources = [];
    this.cssText = defaultCSSText;
  }

  /**
   * Selects the Aurelia conventional defaults for the dialog plugin.
   * @return This instance.
   */
  useDefaults(): DialogConfiguration {
    return this.useRenderer(defaultRenderer)
      .useCSS(defaultCSSText)
      .useStandardResources();
  }

  /**
   * Exports the standard set of dialog behaviors to Aurelia's global resources.
   * @return This instance.
   */
  useStandardResources(): DialogConfiguration {
    return this.useResource('ai-dialog')
      .useResource('ai-dialog-header')
      .useResource('ai-dialog-body')
      .useResource('ai-dialog-footer')
      .useResource('attach-focus');
  }

  /**
   * Exports the chosen dialog element or view to Aurelia's global resources.
   * @param resourceName The name of the dialog resource to export.
   * @return This instance.
   */
  useResource(resourceName: string): DialogConfiguration {
    this.resources.push(resourceName);
    return this;
  }

  /**
   * Configures the plugin to use a specific dialog renderer.
   * @param renderer An object with a Renderer interface.
   * @param settings Global settings for the renderer.
   * @return This instance.
   */
  useRenderer(renderer: Renderer, settings?: Object): DialogConfiguration {
    this.renderer = renderer;
    this.settings = Object.assign(this.settings, settings || {});
    return this;
  }

  /**
   * Configures the plugin to use specific css.
   * @param cssText The css to use in place of the default styles.
   * @return This instance.
   */
  useCSS(cssText: string): DialogConfiguration {
    this.cssText = cssText;
    return this;
  }

  _apply() {
    this.aurelia.singleton(Renderer, this.renderer);
    this.resources.forEach(resourceName => this.aurelia.globalResources(resources[resourceName]));
    DOM.injectStyles(this.cssText);
  }
}
